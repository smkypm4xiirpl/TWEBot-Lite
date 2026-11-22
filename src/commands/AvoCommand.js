import { BotError } from '../errors/BotError.js';
import { BaseCommand } from './BaseCommand.js';

const MEDIA_TYPES = Object.freeze(['imageMessage', 'videoMessage', 'audioMessage']);
const FOOTER = '👁️ _Anti View Once_';
const GROUP_JID_PATTERN = /^\d+(?:-\d+)?@g\.us$/;

/**
 * Mengambil media sekali-lihat (foto/video/voice note) dari pesan yang di-reply lalu mengirim ulang,
 * serta mengelola konfigurasi auto-forward View Once khusus owner bot.
 */
export class AvoCommand extends BaseCommand {
  #cache;
  #prefix;
  #forwarder;
  #owners;
  #groups;
  #logger;

  constructor({ cache, prefix, ownerOnly, forwarder = null, owners = null, groups = null, logger = null }) {
    super({
      name: 'avo',
      aliases: ['rvo'],
      description: 'Buka media view once & kelola auto-forward',
      ownerOnly,
      alwaysAvailable: true,
    });
    this.#cache = cache;
    this.#prefix = prefix;
    this.#forwarder = forwarder;
    this.#owners = owners ?? { isOwner: (ctx) => Boolean(ctx?.fromMe) };
    this.#groups = groups;
    this.#logger = logger;
  }

  async execute(ctx, args = '') {
    const trimmed = (args ?? '').trim();
    const [rawAction, ...rest] = trimmed.split(/\s+/).filter(Boolean);
    const action = rawAction?.toLowerCase();
    this.#logger?.debug(`AvoCommand: dieksekusi oleh ${ctx?.senderLabel ?? 'unknown'} (action=${action || 'manual-recall'})`);

    const setActions = [
      'set', 'on', 'enable',
      'setgroup', 'setgrup', 'setid', 'setgroupid', 'setidgroup',
      'settarget', 'target',
    ];
    const unsetActions = ['unset', 'off', 'disable', 'cleartarget', 'clear'];
    const statusActions = ['status', 'info', 'cek', 'check'];

    if (action && [...setActions, ...unsetActions, ...statusActions, 'help'].includes(action)) {
      if (action === 'help') {
        return this.#handleHelp(ctx);
      }

      if (!this.#owners.isOwner(ctx)) {
        throw new BotError('Perintah ini khusus owner bot.');
      }

      if (setActions.includes(action)) {
        return this.#handleSet(ctx, rest.join(' '));
      }
      if (unsetActions.includes(action)) {
        return this.#handleUnset(ctx);
      }
      if (statusActions.includes(action)) {
        return this.#handleStatus(ctx);
      }
    }

    // Default: un-viewonce pesan yang di-reply (manual recall)
    await this.#handleManualRecall(ctx);
  }

  async #handleSet(ctx, rawTarget) {
    if (!this.#forwarder) {
      throw new BotError('Layanan auto-forward View Once belum aktif.');
    }

    let target = rawTarget?.trim();

    const PLACEHOLDER_KEYWORDS = new Set([
      'groupid', 'idgroup', 'group_id', 'id_group', 'group-id', 'id-group',
      'group', 'grup', 'id', 'target', 'targetgroup', 'targetjid',
    ]);

    if (target) {
      // Bersihkan prefix seperti "groupid: 120...", "groupid 120...", "id: 120..."
      target = target.replace(/^(?:id[_\s-]*group|group[_\s-]*id|target[_\s-]*group|target|group|grup|id)\s*[:=]?\s+/i, '').trim();
      target = target.replace(/^[[<"'(]+|[\]>"')]+$/g, '').trim();
    }

    const strippedLower = target ? target.replace(/^[[<"'(]+|[\]>"')]+$/g, '').trim().toLowerCase() : '';
    const isPlaceholderOnly = Boolean(strippedLower && PLACEHOLDER_KEYWORDS.has(strippedLower));

    if (!target || isPlaceholderOnly) {
      if (ctx.isGroup) {
        target = ctx.jid;
      } else if (isPlaceholderOnly) {
        throw new BotError(
          `ID grup tidak valid: Masukkan ID grup asli (contoh: *1203630xxx@g.us*) atau nomor urut dari *${this.#prefix}bot list*, bukan kata placeholder format.`,
        );
      } else {
        throw new BotError(
          `Sertakan ID grup tujuan: *${this.#prefix}avo set <idGroup>*, atau jalankan perintah ini di dalam grup tujuan.`,
        );
      }
    }

    // Bersihkan karakter pembungkus seperti <...> atau tanda kutip
    target = target.replace(/^[[<"'(]+|[\]>"')]+$/g, '').trim();
    if (!target) {
      throw new BotError(
        `Sertakan ID grup tujuan: *${this.#prefix}avo set <idGroup>*, atau jalankan perintah ini di dalam grup tujuan.`,
      );
    }

    let resolvedJid = target;

    // Dukung nomor urut grup dari daftar grup bot jika input berupa indeks daftar
    if (/^\d+$/.test(target) && target.length <= 4) {
      if (!this.#groups) {
        throw new BotError(`ID grup tidak valid: *${target}*. Format ID grup: 1203630xxx@g.us`);
      }
      const entries = this.#groups.groups();
      const index = Number(target);
      if (index < 1 || index > entries.length) {
        throw new BotError(`Nomor grup *${target}* tidak ada. Lihat daftar dengan *${this.#prefix}bot list*.`);
      }
      resolvedJid = entries[index - 1][0];
    }

    const jid = resolvedJid.endsWith('@g.us') ? resolvedJid : `${resolvedJid}@g.us`;
    const userPart = jid.slice(0, -5);
    if (!GROUP_JID_PATTERN.test(jid) || userPart.replace(/-\d+$/, '').length < 5) {
      throw new BotError(`ID grup tidak valid: *${target}*. Format ID grup: 1203630xxx@g.us`);
    }

    await this.#forwarder.setTarget(jid);
    await ctx.react('✅');

    let name = jid;
    if (this.#groups) {
      const known = this.#groups.getGroupName?.(jid) ?? this.#groups.groups().find(([groupJid]) => groupJid === jid)?.[1];
      if (known) name = known;
    }
    if (name === jid && typeof ctx.groupSubject === 'function') {
      try {
        const fetched = await ctx.groupSubject(jid);
        if (fetched) name = fetched;
      } catch {}
    }

    return ctx.reply(
      [
        '👁️ *AUTO-FORWARD VIEW ONCE DIAKTIFKAN*',
        '',
        `👥 *Grup Tujuan:* *${name}*`,
        `🆔 *ID Grup:* ${jid}`,
        '',
        'Semua media sekali-lihat (foto, video, voice note) yang diterima bot akan otomatis diteruskan ke grup ini.',
      ].join('\n'),
    );
  }

  async #handleUnset(ctx) {
    if (!this.#forwarder) {
      throw new BotError('Layanan auto-forward View Once belum aktif.');
    }

    await this.#forwarder.clearTarget();
    await ctx.react('✅');
    return ctx.reply('👁️ Auto-forward View Once telah *dinonaktifkan*.');
  }

  async #handleStatus(ctx) {
    const targetJid = this.#forwarder?.targetJid;
    if (targetJid) {
      let name = targetJid;
      if (this.#groups) {
        const known = this.#groups.getGroupName?.(targetJid) ?? this.#groups.groups().find(([j]) => j === targetJid)?.[1];
        if (known) name = known;
      }
      if (name === targetJid && typeof ctx.groupSubject === 'function') {
        try {
          const fetched = await ctx.groupSubject(targetJid);
          if (fetched) name = fetched;
        } catch {}
      }

      return ctx.reply(
        [
          '👁️ *STATUS ANTI VIEW ONCE*',
          '',
          '📌 *Auto-Forward:* 🟢 Aktif',
          `👥 *Grup Tujuan:* *${name}*`,
          `🆔 *ID Grup:* ${targetJid}`,
          '',
          `_Gunakan *${this.#prefix}avo unset* untuk mematikan._`,
        ].join('\n'),
      );
    }

    return ctx.reply(
      [
        '👁️ *STATUS ANTI VIEW ONCE*',
        '',
        '📌 *Auto-Forward:* 🔴 Nonaktif',
        '',
        `_Gunakan *${this.#prefix}avo set [ID grup]* untuk mengaktifkan._`,
      ].join('\n'),
    );
  }

  async #handleHelp(ctx) {
    const p = this.#prefix;
    const isOwner = this.#owners.isOwner(ctx);
    const lines = [
      '👁️ *ANTI VIEW ONCE*',
      '',
      `*Reply* foto, video, atau voice note sekali-lihat dengan *${p}avo* untuk membukanya.`,
    ];

    if (isOwner) {
      lines.push(
        '',
        '👑 *Perintah Khusus Owner:*',
        `├ *${p}avo set [ID grup]* — Aktifkan auto-forward ke grup tujuan`,
        `├ *${p}avo unset* — Nonaktifkan auto-forward`,
        `└ *${p}avo status* — Cek status auto-forward saat ini`,
      );
    }

    return ctx.reply(lines.join('\n'));
  }

  async #handleManualRecall(ctx) {
    // Referensi yang dicatat saat pesan masuk lebih andal daripada kutipan yang sering dikosongkan WA.
    this.#logger?.debug('AvoCommand: mencari media view-once yang di-reply (quoted/cache)...');
    const media = this.#cache?.recall(ctx) ?? ctx.findMedia?.(MEDIA_TYPES, { scope: 'quoted' });

    if (!media) {
      this.#logger?.debug('AvoCommand: tidak ditemukan media view-once yang dapat dibuka');
      await ctx.react('❓');
      const lines = [
        '👁️ *ANTI VIEW ONCE*',
        '',
        `*Reply* foto, video, atau voice note sekali-lihat dengan *${this.#prefix}avo*.`,
        '',
        '_Hanya bisa membuka pesan yang diterima bot setelah bot aktif._',
      ];
      if (this.#owners.isOwner(ctx)) {
        lines.push(
          '',
          '👑 *Perintah Khusus Owner:*',
          `├ *${this.#prefix}avo set [ID grup]* — Aktifkan auto-forward ke grup tujuan`,
          `├ *${this.#prefix}avo unset* — Nonaktifkan auto-forward`,
          `├ *${this.#prefix}avo status* — Cek status auto-forward saat ini`,
          `└ *${this.#prefix}avo help* — Panduan lengkap`,
        );
      }
      return ctx.reply(lines.join('\n'));
    }

    if (!media.viewOnce) {
      this.#logger?.debug(`AvoCommand: media ditemukan (${media.type}) tetapi bukan view-once`);
      throw new BotError('Pesan yang di-reply bukan media sekali-lihat (view-once).');
    }

    this.#logger?.debug(`AvoCommand: mengunduh media view-once (${media.type})...`);
    await ctx.react('⏳');
    const buffer = await ctx.download(media, {
      failureMessage:
        'Media tidak bisa diambil. Kemungkinan sudah kedaluwarsa atau sudah dihapus dari server WhatsApp.',
    });
    this.#logger?.debug(
      `AvoCommand: unduhan media selesai (${(buffer.length / 1024).toFixed(1)} KB), mengirim kembali ke ${ctx?.chatLabel ?? 'chat'}...`,
    );
    await this.#resend(ctx, media, buffer);
    await ctx.react('✅');
    this.#logger?.debug('AvoCommand: media view-once sukses dikirim kembali');
  }

  #resend(ctx, { type, node }, buffer) {
    const caption = [node.caption, FOOTER].filter(Boolean).join('\n\n');

    switch (type) {
      case 'imageMessage':
        return ctx.sendImage(buffer, caption);
      case 'videoMessage':
        return ctx.sendVideo(buffer, { caption, mimetype: node.mimetype });
      case 'audioMessage':
        return ctx.sendAudio(buffer, { ptt: Boolean(node.ptt), mimetype: node.mimetype });
      default:
        throw new BotError('Jenis media ini belum didukung.');
    }
  }
}
