import { jidDecode } from '@whiskeysockets/baileys';

/**
 * Menentukan apakah pengirim adalah owner.
 * Akun bot sendiri (fromMe) selalu owner. Owner lain didaftarkan lewat OWNER_NUMBERS
 * (nomor HP atau ID LID, baik format digit murni maupun JID WhatsApp).
 */
export class OwnerPolicy {
  #owners;

  constructor(numbers = []) {
    const list = Array.isArray(numbers) ? numbers : (numbers ? [numbers] : []);
    const normalized = [];
    for (const item of list) {
      if (item === null || item === undefined) continue;
      const str = String(item).trim();
      if (!str) continue;
      const userPart = str.split('@')[0].split(':')[0];
      const digits = userPart.replace(/\D/g, '');
      if (digits) normalized.push(digits);
      if (userPart && userPart !== digits) normalized.push(userPart);
    }
    this.#owners = new Set(normalized);
  }

  get configuredCount() {
    return this.#owners.size;
  }

  isOwner(ctx) {
    if (!ctx) return false;
    if (typeof ctx === 'string') {
      try {
        const decodedUser = jidDecode(ctx)?.user;
        if (decodedUser) {
          const cleanedUser = decodedUser.replace(/\D/g, '');
          if (cleanedUser && this.#owners.has(cleanedUser)) return true;
          if (this.#owners.has(decodedUser)) return true;
        }
      } catch {}
      const rawUser = String(ctx).split('@')[0].split(':')[0];
      const rawDigits = rawUser.replace(/\D/g, '');
      if (rawDigits && this.#owners.has(rawDigits)) return true;
      if (rawUser && this.#owners.has(rawUser)) return true;
      return this.#owners.has(ctx);
    }
    if (ctx.fromMe) return true;

    const ids = Array.isArray(ctx.identityUsers) ? ctx.identityUsers : [];
    for (const id of ids) {
      if (!id) continue;
      const cleaned = String(id).split('@')[0].split(':')[0].replace(/\D/g, '');
      if (this.#owners.has(cleaned) || this.#owners.has(String(id))) {
        return true;
      }
    }

    const candidates = [
      ctx.senderJid,
      ctx.participant,
      ctx.sender,
      !ctx.isGroup ? ctx.jid : null,
      ctx.key?.participant,
      ctx.key?.participantAlt,
      ctx.key?.remoteJidAlt,
      !ctx.isGroup ? ctx.key?.remoteJid : null,
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        const decodedUser = jidDecode(candidate)?.user;
        if (decodedUser) {
          const cleanedUser = decodedUser.replace(/\D/g, '');
          if (cleanedUser && this.#owners.has(cleanedUser)) return true;
          if (this.#owners.has(decodedUser)) return true;
        }
      } catch {}
      const rawUser = String(candidate).split('@')[0].split(':')[0];
      const rawDigits = rawUser.replace(/\D/g, '');
      if (rawDigits && this.#owners.has(rawDigits)) return true;
      if (rawUser && this.#owners.has(rawUser)) return true;
    }

    return false;
  }
}
