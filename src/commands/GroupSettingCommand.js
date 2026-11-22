import { areJidsSameUser, jidDecode } from '@whiskeysockets/baileys';
import { BotError } from '../errors/BotError.js';
import { BaseCommand } from './BaseCommand.js';

/**
 * Command dasar untuk mengelola pengaturan grup (misalnya tutup/buka akses pesan member).
 * Memvalidasi apakah perintah dijalankan di grup, apakah bot adalah admin,
 * dan apakah pengirim adalah admin grup atau owner bot.
 */
export class GroupSettingCommand extends BaseCommand {
  #targetSetting;
  #owners;
  #logger;

  constructor({
    name,
    aliases = [],
    description,
    targetSetting, // 'announcement' | 'not_announcement'
    owners = null,
    logger = null,
  }) {
    super({
      name,
      aliases,
      description,
      ownerOnly: false,
      alwaysAvailable: false,
    });
    this.#targetSetting = targetSetting;
    this.#owners = owners;
    this.#logger = logger;
  }

  get targetSetting() {
    return this.#targetSetting;
  }

  async execute(ctx) {
    if (!ctx?.isGroup) {
      throw new BotError('Perintah ini hanya dapat digunakan di dalam grup.');
    }

    this.#logger?.debug(`${this.name}: memeriksa izin grup dan status admin untuk ${ctx.senderLabel}`);

    const metadata = await this.#fetchMetadata(ctx);
    if (!metadata) {
      throw new BotError('Informasi grup tidak dapat ditemukan.');
    }

    const sock = ctx.sock;
    const isBotAdmin = this.#isBotAdmin(metadata, sock, ctx);
    if (!isBotAdmin) {
      throw new BotError('Bot harus menjadi admin grup terlebih dahulu untuk mengubah setelan ini.');
    }

    const isAuthorized = this.#isCallerAuthorized(ctx, metadata);
    if (!isAuthorized) {
      throw new BotError('Perintah ini hanya dapat digunakan oleh admin grup atau owner bot.');
    }

    try {
      await ctx.react?.('⏳');
    } catch {
      // Reaksi bersifat fire-and-forget
    }

    try {
      if (sock && typeof sock.groupSettingUpdate === 'function') {
        await sock.groupSettingUpdate(ctx.jid, this.#targetSetting);
      } else if (typeof ctx.groupSettingUpdate === 'function') {
        await ctx.groupSettingUpdate(ctx.jid, this.#targetSetting);
      } else {
        throw new Error('Metode groupSettingUpdate tidak tersedia pada socket WhatsApp.');
      }
    } catch (error) {
      if (error instanceof BotError) throw error;
      this.#logger?.error(`Gagal mengubah setelan grup ke ${this.#targetSetting}`, error);
      throw new BotError('Gagal memperbarui setelan grup. Pastikan bot memiliki hak admin penuh.', { cause: error });
    }

    try {
      await ctx.react?.('✅');
    } catch {
      // Reaksi bersifat fire-and-forget
    }

    const callerName = ctx.pushName?.trim() || ctx.senderLabel || 'Admin';
    return ctx.reply(this.#formatAnnouncement(callerName));
  }

  async #fetchMetadata(ctx) {
    try {
      if (typeof ctx.groupMetadata === 'function') {
        return await ctx.groupMetadata(ctx.jid);
      }
      if (typeof ctx.sock?.groupMetadata === 'function') {
        return await ctx.sock.groupMetadata(ctx.jid);
      }
    } catch (error) {
      this.#logger?.error('Gagal mengambil metadata grup', error);
      throw new BotError('Gagal memuat informasi grup. Pastikan bot berada di dalam grup ini.', { cause: error });
    }
    return null;
  }

  #isBotAdmin(metadata, sock, ctx) {
    if (!Array.isArray(metadata?.participants)) return false;

    const botJids = [
      sock?.user?.id,
      sock?.user?.lid,
      sock?.authState?.creds?.me?.id,
      sock?.authState?.creds?.me?.lid,
      ctx?.sockUser?.id,
      ctx?.sockUser?.lid,
    ].filter(Boolean);

    const botUsers = botJids.flatMap((jid) => {
      const decoded = jidDecode(jid)?.user;
      const rawUser = String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
      return [decoded ? decoded.replace(/\D/g, '') : null, rawUser || null];
    }).filter(Boolean);

    return metadata.participants.some((p) => {
      const isAdmin = p?.admin === 'admin' || p?.admin === 'superadmin' || Boolean(p?.isAdmin) || Boolean(p?.isSuperAdmin);
      if (!isAdmin) return false;

      for (const bJid of botJids) {
        if (bJid === p.id) return true;
        try {
          if (areJidsSameUser(p.id, bJid)) return true;
        } catch {}
      }

      const pUser = jidDecode(p.id)?.user?.replace(/\D/g, '');
      const pRaw = String(p.id).split('@')[0].split(':')[0].replace(/\D/g, '');
      if ((pUser && botUsers.includes(pUser)) || (pRaw && botUsers.includes(pRaw))) return true;

      return false;
    });
  }

  #isCallerAuthorized(ctx, metadata) {
    if (ctx.fromMe || (this.#owners && typeof this.#owners.isOwner === 'function' && this.#owners.isOwner(ctx))) {
      return true;
    }

    if (!Array.isArray(metadata?.participants)) return false;

    const callerUsers = Array.isArray(ctx.identityUsers) ? ctx.identityUsers : [];
    const callerJids = [
      ctx.senderJid,
      ctx.participant,
      ctx.key?.participant,
      ctx.key?.participantAlt,
      ctx.key?.remoteJidAlt,
      ctx.sender,
      !ctx.isGroup ? ctx.jid : null,
      !ctx.isGroup ? ctx.key?.remoteJid : null,
    ].filter(Boolean);

    return metadata.participants.some((p) => {
      const isAdmin = p?.admin === 'admin' || p?.admin === 'superadmin' || Boolean(p?.isAdmin) || Boolean(p?.isSuperAdmin);
      if (!isAdmin) return false;

      for (const cJid of callerJids) {
        if (cJid === p.id) return true;
        try {
          if (areJidsSameUser(p.id, cJid)) return true;
        } catch {}
      }

      const pUser = jidDecode(p.id)?.user?.replace(/\D/g, '');
      const pRaw = String(p.id).split('@')[0].split(':')[0].replace(/\D/g, '');
      if (pUser && callerUsers.some((u) => String(u).split('@')[0].split(':')[0].replace(/\D/g, '') === pUser)) {
        return true;
      }
      if (pRaw && callerUsers.some((u) => String(u).split('@')[0].split(':')[0].replace(/\D/g, '') === pRaw)) {
        return true;
      }
      if (pRaw && callerJids.some((j) => String(j).split('@')[0].split(':')[0].replace(/\D/g, '') === pRaw)) {
        return true;
      }

      return false;
    });
  }

  #formatAnnouncement(callerName) {
    if (this.#targetSetting === 'announcement') {
      return [
        '╭───「 *AKSES GRUP DITUTUP* 」',
        '│ 🔒 *Status:* Hanya Admin',
        `│ 👤 *Admin:* ${callerName}`,
        '│ 📢 *Keterangan:* Akses kirim pesan untuk member telah ditutup.',
        '╰────────────────────────',
      ].join('\n');
    }

    return [
      '╭───「 *AKSES GRUP DIBUKA* 」',
      '│ 🔓 *Status:* Semua Peserta',
      `│ 👤 *Admin:* ${callerName}`,
      '│ 📢 *Keterangan:* Akses kirim pesan untuk seluruh member telah dibuka.',
      '╰────────────────────────',
    ].join('\n');
  }
}

export { GroupSettingCommand as GroupAdminCommand };
