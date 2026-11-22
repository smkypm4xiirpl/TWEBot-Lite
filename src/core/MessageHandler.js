import { performance } from 'node:perf_hooks';
import { BotError } from '../errors/BotError.js';
import { Semaphore } from '../utils/Semaphore.js';
import { MessageContext } from './MessageContext.js';

/**
 * Menerima event pesan, menerapkan aturan akses (grup aktif/nonaktif, owner),
 * mengeksekusi command, dan menangani error secara terpusat dengan pembatasan konkurensi (OOM guard).
 */
export class MessageHandler {
  #registry;
  #parser;
  #logger;
  #config;
  #groups;
  #owners;
  #viewOnceCache;
  #limiter;
  #forwarder;
  #pending = 0;
  #maxPending = 100;

  constructor({ registry, parser, logger, config, groups, owners, viewOnceCache, forwarder = null }) {
    this.#registry = registry;
    this.#parser = parser;
    this.#logger = logger;
    this.#config = config;
    this.#groups = groups;
    this.#owners = owners;
    this.#viewOnceCache = viewOnceCache;
    this.#limiter = new Semaphore(config?.messageConcurrency ?? 5);
    this.#forwarder = forwarder;
  }

  handle(sock, { messages, type } = {}) {
    if (type !== 'notify' || !Array.isArray(messages)) {
      if (type && type !== 'notify') {
        this.#logger.debug(`messages.upsert dilewati: type=${type} (bukan notify)`);
      }
      return;
    }

    if (messages.length > 0) {
      this.#logger.debug(`Menerima ${messages.length} pesan baru (notify)`);
    }

    for (const message of messages) {
      // Backpressure: buang pesan baru saat antrean penuh (proteksi OOM saat lonjakan)
      if (this.#pending >= this.#maxPending) {
        this.#logger.warn(`Antrean pesan penuh (${this.#maxPending}), pesan baru dibuang.`);
        continue;
      }
      this.#pending += 1;
      // Dibatasi konkurensinya agar tidak kehabisan memori (OOM) saat menerima lonjakan media
      this.#limiter
        .run(() => this.#process(sock, message))
        .catch((error) => this.#logger.error('Gagal memproses pesan', error))
        .finally(() => {
          this.#pending -= 1;
        });
    }
  }

  async syncGroups(sock) {
    try {
      if (!sock || typeof sock.groupFetchAllParticipating !== 'function') {
        this.#logger.warn('Socket tidak valid atau tidak mendukung groupFetchAllParticipating.');
        return;
      }

      const accountId = this.#getAccountId(sock);
      if (accountId && typeof this.#groups.bindAccount === 'function') {
        await this.#groups.bindAccount(accountId);
      }

      const groups = await sock.groupFetchAllParticipating();
      if (!groups || typeof groups !== 'object') {
        this.#logger.warn('groupFetchAllParticipating tidak mengembalikan data grup yang valid.');
        return;
      }

      const entries = Array.isArray(groups)
        ? groups.map((item) => {
            if (Array.isArray(item)) return [item[0], item[1] ?? item[0]];
            if (typeof item === 'string') return [item, item];
            const jid = item?.id ?? item?.jid ?? '';
            const subject = typeof item?.subject === 'string' && item.subject.trim()
              ? item.subject.trim()
              : (typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : jid);
            return [jid, subject];
          })
        : Object.entries(groups).map(([jid, metadata]) => {
            const subject = typeof metadata === 'string' && metadata.trim()
              ? metadata.trim()
              : (typeof metadata?.subject === 'string' && metadata.subject.trim()
                  ? metadata.subject.trim()
                  : (typeof metadata?.name === 'string' && metadata.name.trim() ? metadata.name.trim() : jid));
            return [jid, subject];
          });

      if (typeof this.#groups.syncGroups === 'function') {
        await this.#groups.syncGroups(entries);
      } else {
        await this.#groups.rememberGroups(entries);
      }
      this.#logger.info(`Daftar grup disinkronkan (${entries.length} grup${accountId ? ` untuk nomor ${accountId}` : ''}).`);
    } catch (error) {
      this.#logger.error('Gagal menyinkronkan daftar grup dari WhatsApp', error);
    }
  }

  async rememberGroups(sock) {
    return this.syncGroups(sock);
  }

  #getAccountId(sock) {
    const rawId = sock?.user?.id;
    if (!rawId || typeof rawId !== 'string') return null;
    const numberPart = rawId.split(':')[0].split('@')[0].replace(/\D/g, '');
    return numberPart || rawId;
  }

  async #process(sock, message) {
    if (!message.message) return;
    if (message.key.remoteJid === 'status@broadcast') {
      this.#logger.debug('Pesan status@broadcast diabaikan');
      return;
    }
    if (this.#isStale(message)) {
      const age = Math.round(Date.now() / 1000 - Number(message.messageTimestamp ?? 0));
      this.#logger.debug(`Pesan diabaikan: kedaluwarsa (${age}s > ${this.#config.staleMessageSeconds}s)`);
      return;
    }

    // bindAccount sudah dipanggil sekali per koneksi via syncGroups()
    // (BotClient 'open' -> rememberGroups); tidak diulang per pesan.

    const ctx = new MessageContext({
      sock,
      message,
      maxInputBytes: this.#config.maxInputBytes,
      logger: this.#logger,
    });

    const types = Array.isArray(ctx.detectedTypes) ? ctx.detectedTypes.join(', ') : 'unknown';
    const rawText = (ctx.text || '').replace(/\s+/g, ' ').trim();
    const textPreview = rawText
      ? (rawText.length > 50 ? `"${rawText.slice(0, 47)}..."` : `"${rawText}"`)
      : '(tidak ada teks)';
    this.#logger.debug(
      `Pesan masuk dari ${ctx.senderLabel} @ ${ctx.chatLabel} [jid: ${ctx.jid}]: tipe=[${types}], teks=${textPreview}`,
    );

    if (ctx.isGroup) {
      const isKnown = typeof this.#groups.hasGroup === 'function'
        ? this.#groups.hasGroup(ctx.jid)
        : this.#groups.groups().some(([jid]) => jid === ctx.jid);
      if (!isKnown) {
        const subject = await ctx.groupSubject(ctx.jid);
        await this.#groups.rememberGroup(ctx.jid, subject ?? ctx.jid);
        this.#logger.debug(`Grup baru terdeteksi dan dicatat: ${subject ?? ctx.jid} (${ctx.jid})`);
      }
    }

    const groupEnabled = !ctx.isGroup || this.#groups.isEnabled(ctx.jid);
    const isOwner = this.#owners.isOwner(ctx);
    const privateOnly = Boolean(this.#groups.privateOnly);

    this.#logger.debug(
      `Pengecekan kebijakan: chat=${ctx.chatLabel}, grup=${ctx.isGroup ? (groupEnabled ? 'aktif' : 'nonaktif') : 'n/a'}, privateOnly=${privateOnly}, owner=${isOwner}`,
    );

    // Kebijakan View Once: cache (.avo) dan auto-forward menerapkan aturan akses
    // yang SAMA — media di grup nonaktif / privateOnly tidak dicatat maupun diteruskan.
    const viewOnceAllowed = groupEnabled && (!this.#groups.privateOnly || !ctx.isGroup);
    if (!viewOnceAllowed) {
      this.#logger.debug('ViewOnce: pesan dilewati karena grup nonaktif atau mode privateOnly');
    }

    // Grup yang dinonaktifkan tidak boleh dicatat sama sekali.
    if (viewOnceAllowed) {
      this.#viewOnceCache.remember(ctx);
    }

    // Auto-forward View Once hanya untuk chat yang lolos kebijakan akses.
    if (this.#forwarder && viewOnceAllowed) {
      try {
        await this.#forwarder.handleMessage(ctx, sock);
      } catch (error) {
        this.#logger.error('Gagal memproses auto-forward View Once', error);
      }
    }

    const parsed = this.#parser.parse(ctx.text);
    if (!parsed) {
      this.#logger.debug('Bukan command: teks tidak mengandung prefix bot (chat biasa diabaikan)');
      return;
    }

    const command = this.#registry.resolve(parsed.name);
    if (!command) {
      this.#logger.debug(
        `Command tidak dikenal: "${parsed.prefix}${parsed.name}" (prefix="${parsed.prefix}", nama="${parsed.name}") (diabaikan)`,
      );
      return;
    }

    const argSnippet = parsed.args
      ? (parsed.args.length > 40 ? `"${parsed.args.slice(0, 37)}..."` : `"${parsed.args}"`)
      : '(tanpa argumen)';
    this.#logger.debug(
      `Command dikenali: "${parsed.prefix}${parsed.name}" (prefix="${parsed.prefix}", nama="${command.name}"), argumen: ${argSnippet}`,
    );

    const isRestrictedGroup = ctx.isGroup && (privateOnly || !groupEnabled);
    if (isRestrictedGroup && !isOwner) {
      this.#logger.debug(`Diabaikan: bot nonaktif di grup ${ctx.jid}${privateOnly ? ' (mode privateOnly aktif)' : ''}`);
      return;
    }

    await this.#run(ctx, command, parsed);
  }

  async #run(ctx, command, parsed) {
    const startedAt = performance.now();
    let status = 'ok';

    try {
      this.#authorize(ctx, command);
      ctx.setTyping(true); // Non-blocking fire-and-forget
      await command.execute(ctx, parsed.args);
    } catch (error) {
      status = 'fail';
      await this.#reportError(ctx, error);
    } finally {
      ctx.setTyping(false); // Non-blocking fire-and-forget
      this.#logger.command({
        name: `${parsed.prefix}${parsed.name}`,
        sender: ctx.senderLabel,
        chat: ctx.chatLabel,
        status,
        durationMs: performance.now() - startedAt,
      });
    }
  }

  #authorize(ctx, command) {
    const isOwner = this.#owners.isOwner(ctx);
    if (!command.ownerOnly) {
      this.#logger.debug(`Otorisasi: command "${command.name}" bersifat publik (owner=${isOwner})`);
      return;
    }

    if (isOwner) {
      this.#logger.debug(`Otorisasi: command owner-only "${command.name}" diizinkan untuk ${ctx.senderLabel}`);
      return;
    }

    this.#logger.warn(`Akses owner ditolak untuk ${ctx.senderLabel} [id: ${ctx.identityUsers.join(', ') || '?'}]`);
    throw new BotError('Perintah ini khusus owner bot.');
  }

  async #reportError(ctx, error) {
    ctx.react('❌'); // Non-blocking fire-and-forget

    if (error instanceof BotError) {
      if (error.cause) this.#logger.error(error.userMessage, error);
      else this.#logger.warn(error.userMessage);
      await ctx.reply(`⚠️ ${error.userMessage}`);
      return;
    }

    this.#logger.error('Error tak terduga saat menjalankan command', error);
    await ctx.reply('❌ Terjadi kesalahan internal. Silakan coba lagi sebentar lagi.');
  }

  #isStale(message) {
    const timestamp = Number(message.messageTimestamp ?? 0);
    return timestamp > 0 && Date.now() / 1000 - timestamp > this.#config.staleMessageSeconds;
  }
}
