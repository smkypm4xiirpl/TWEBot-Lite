import { BotError } from '../errors/BotError.js';

const MEDIA_TYPES = Object.freeze(['imageMessage', 'videoMessage', 'audioMessage', 'ptvMessage']);

function sanitizeTargetJid(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/^[[<"'(]+|[\]>"')]+$/g, '').trim();
  if (!cleaned) return null;
  return cleaned.endsWith('@g.us') ? cleaned : `${cleaned}@g.us`;
}

function extractTargetJid(data) {
  if (!data) return undefined;
  if (typeof data === 'string') {
    return sanitizeTargetJid(data);
  }
  if (typeof data === 'object') {
    const raw =
      data.targetJid !== undefined
        ? data.targetJid
        : data.groupId !== undefined
        ? data.groupId
        : data.idGroup !== undefined
        ? data.idGroup
        : data.target !== undefined
        ? data.target
        : data.group !== undefined
        ? data.group
        : data.jid !== undefined
        ? data.jid
        : data.targetGroup;

    if (raw !== undefined) {
      return typeof raw === 'string' ? sanitizeTargetJid(raw) : null;
    }
  }
  return undefined;
}

/**
 * Mengelola konfigurasi dan penerusan otomatis media View Once (foto, video, voice note)
 * ke grup tujuan yang telah ditentukan oleh owner bot.
 */
export class ViewOnceForwarder {
  #store;
  #logger;
  #groups;
  #defaultTarget;
  #targetJid = null;
  #forwardedIds = new Set();
  #inflight = new Set();
  #maxHistory;

  constructor({ store = null, logger = null, groups = null, defaultTarget = null, maxHistory = 1000 } = {}) {
    this.#store = store;
    this.#logger = logger;
    this.#groups = groups;
    this.#defaultTarget = typeof defaultTarget === 'string' && defaultTarget.trim() ? sanitizeTargetJid(defaultTarget) : null;
    this.#maxHistory = maxHistory;
    this.#targetJid = !store && this.#defaultTarget ? this.#defaultTarget : null;
  }

  async init() {
    if (this.#store) {
      // Satu file, satu format: baca target + riwayat dedupe.
      const data = await this.#store.load(null);

      const extracted = data ? extractTargetJid(data) : undefined;
      if (extracted) {
        this.#targetJid = extracted;
      } else if (data && extractTargetJid(data) !== undefined) {
        // Data structured dengan targetJid null (sengaja di-unset) — hormati.
        this.#targetJid = extractTargetJid(data);
      } else if (this.#defaultTarget) {
        this.#targetJid = this.#defaultTarget;
      }

      // Pulihkan riwayat dedupe agar pesan re-delivered setelah restart tidak ter-forward dua kali.
      if (Array.isArray(data?.forwardedIds)) {
        this.#forwardedIds = new Set(data.forwardedIds.filter((id) => typeof id === 'string').slice(-this.#maxHistory));
      }

      // Pastikan file antiviewonce.json terinisialisasi dan tidak 0-byte kosong di disk
      await this.#persist().catch((err) => {
        this.#logger?.debug(`Gagal inisialisasi persistensi awal: ${err?.message}`);
      });
    } else if (this.#defaultTarget) {
      this.#targetJid = this.#defaultTarget;
    }
  }

  get targetJid() {
    return this.#targetJid;
  }

  get isConfigured() {
    return Boolean(this.#targetJid);
  }

  async setTarget(jid) {
    this.#targetJid = sanitizeTargetJid(jid);
    if (this.#store) {
      await this.#persist();
    }
    this.#logger?.info(`Target auto-forward View Once diatur ke: ${this.#targetJid}`);
  }

  async clearTarget() {
    this.#targetJid = null;
    if (this.#store) {
      await this.#persist();
    }
    this.#logger?.info('Target auto-forward View Once dinonaktifkan.');
  }

  /**
   * Mendeteksi dan meneruskan media View Once jika grup tujuan aktif.
   * Mengembalikan boolean apakah pesan diproses/diteruskan.
   */
  async handleMessage(ctx, sock) {
    if (!this.#targetJid) return false;
    if (ctx.fromMe) return false;

    const media = ctx.findMedia(MEDIA_TYPES, { scope: 'own' });
    if (!media?.viewOnce) return false;

    const dedupeKey = ctx.messageId ? `${ctx.jid}|${ctx.messageId}` : null;
    if (dedupeKey && (this.#forwardedIds.has(dedupeKey) || this.#inflight.has(dedupeKey))) {
      this.#logger?.debug(`Mengabaikan View Once duplikat atau sedang diproses: ${dedupeKey}`);
      return false;
    }

    if (dedupeKey) {
      this.#inflight.add(dedupeKey);
    }

    try {
      this.#logger?.info(
        `Mendeteksi View Once (${media.type}) dari ${ctx.senderLabel} (${ctx.chatLabel}). Mengunduh dan meneruskan ke ${this.#targetJid}...`,
      );

      const buffer = await ctx.download(media, {
        failureMessage: 'Gagal mengunduh media View Once untuk auto-forward.',
      });
      this.#logger?.debug(
        `ViewOnceForwarder: unduhan berhasil (${(buffer.length / 1024).toFixed(1)} KB), meneruskan ke target socket...`,
      );

      await this.forwardMedia(sock, media, buffer, ctx);

      if (dedupeKey) {
        this.#forwardedIds.add(dedupeKey);
        while (this.#forwardedIds.size > this.#maxHistory) {
          const oldest = this.#forwardedIds.values().next().value;
          this.#forwardedIds.delete(oldest);
        }
        // Simpan riwayat dedupe agar dedupe bertahan lintas restart bot.
        this.#persist().catch((err) => this.#logger?.debug(`Gagal menyimpan riwayat dedupe: ${err?.message}`));
      }

      this.#logger?.info(`Sukses meneruskan View Once ke ${this.#targetJid}`);
      return true;
    } catch (error) {
      this.#logger?.error(`Gagal memproses auto-forward View Once dari ${ctx.senderLabel}`, error);
      return false;
    } finally {
      if (dedupeKey) {
        this.#inflight.delete(dedupeKey);
      }
    }
  }

  async forwardMedia(sock, media, buffer, ctx) {
    if (!this.#targetJid) return;

    let groupName = null;
    if (ctx.isGroup) {
      const cached = this.#groups?.groups().find(([j]) => j === ctx.jid)?.[1];
      if (cached && cached !== ctx.jid) {
        groupName = cached;
      } else if (typeof ctx.groupSubject === 'function') {
        try {
          groupName = await ctx.groupSubject(ctx.jid);
        } catch {
          groupName = null;
        }
      }
    }

    const caption = this.buildCaption(ctx, media, groupName);

    switch (media.type) {
      case 'imageMessage':
        return sock.sendMessage(this.#targetJid, {
          image: buffer,
          caption,
          mimetype: media.node?.mimetype || 'image/jpeg',
        });

      case 'videoMessage':
      case 'ptvMessage':
        return sock.sendMessage(this.#targetJid, {
          video: buffer,
          caption,
          mimetype: media.node?.mimetype || 'video/mp4',
          gifPlayback: Boolean(media.node?.gifPlayback),
        });

      case 'audioMessage': {
        const sent = await sock.sendMessage(this.#targetJid, {
          audio: buffer,
          ptt: Boolean(media.node?.ptt),
          mimetype: media.node?.mimetype || 'audio/ogg; codecs=opus',
        });
        return sock.sendMessage(
          this.#targetJid,
          { text: caption },
          sent?.key ? { quoted: sent } : undefined,
        );
      }

      default:
        this.#logger?.warn(`Jenis media View Once tidak didukung: ${media.type}`);
        return null;
    }
  }

  buildCaption(ctx, media, groupName = null) {
    const origin = ctx.isGroup
      ? `Grup *${groupName ?? ctx.jid}* (${ctx.jid})`
      : 'Pesan Pribadi (Private Chat)';

    const lines = [
      '👁️ *FORWARDED VIEW ONCE*',
      `📌 *Asal:* ${origin}`,
      `👤 *Pengirim:* ${ctx.senderLabel}`,
    ];

    const originalCaption = media.node?.caption || media.node?.text;
    if (originalCaption && typeof originalCaption === 'string' && originalCaption.trim()) {
      lines.push('', '💬 *Caption Asli:*', originalCaption.trim());
    }

    return lines.join('\n');
  }

  #persist() {
    if (!this.#store) return Promise.resolve();
    // Format tunggal: targetJid + riwayat dedupe (dipulihkan saat init).
    return this.#store.save({
      targetJid: this.#targetJid,
      forwardedIds: [...this.#forwardedIds],
      updatedAt: new Date().toISOString(),
    });
  }
}
