import { BotError } from '../errors/BotError.js';
import { BaseCommand } from './BaseCommand.js';

/** Kirim foto profil akun yang di-mention. */
export class GetPpCommand extends BaseCommand {
  #logger;

  constructor({ logger = null } = {}) {
    super({ name: 'getpp', description: 'Ambil foto profil user yang di-mention' });
    this.#logger = logger;
  }

  async execute(ctx) {
    const jid = ctx.mentionedJids[0];
    if (!jid) {
      this.#logger?.debug('GetPpCommand: tidak ada mention user yang disertakan');
      throw new BotError('Mention user yang ingin dilihat foto profilnya. Contoh: *.getpp @user*');
    }
    this.#logger?.debug(`GetPpCommand: mengambil foto profil untuk mention=${jid}...`);
    const image = await ctx.profilePicture(jid);
    if (!image) {
      this.#logger?.debug(`GetPpCommand: foto profil untuk ${jid} tidak tersedia`);
      throw new BotError('Foto profil user tidak tersedia atau disembunyikan oleh pengaturan privasinya.');
    }
    this.#logger?.debug(
      `GetPpCommand: foto profil berhasil didapatkan (${(image.length / 1024).toFixed(1)} KB), mengirim gambar...`,
    );
    await ctx.sendImage(image, 'Foto profil user');
  }
}
