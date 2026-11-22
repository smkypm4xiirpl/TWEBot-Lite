import { BotError } from '../errors/BotError.js';
import { BaseCommand } from './BaseCommand.js';

export class ToVideoCommand extends BaseCommand {
  #converter;
  #background;
  #prefix;
  #logger;

  constructor({ converter, background, prefix, logger = null }) {
    super({ name: 'tovid', aliases: ['togif', 'tovideo'], description: 'Ubah sticker animasi menjadi video/GIF' });
    this.#converter = converter;
    this.#background = background;
    this.#prefix = prefix;
    this.#logger = logger;
  }

  async execute(ctx) {
    const media = ctx.findMedia(['stickerMessage']);

    if (!media) {
      this.#logger?.debug('ToVideoCommand: tidak ada sticker yang di-reply/ditemukan');
      await ctx.react('❓');
      await ctx.reply(
        [
          '🎬 *STICKER ANIMASI ➜ VIDEO*',
          '',
          `Reply sebuah *sticker animasi* dengan *${this.#prefix}tovid*.`,
          `_Untuk sticker biasa gunakan ${this.#prefix}toimg._`,
        ].join('\n'),
      );
      return;
    }

    if (!media.node.isAnimated) {
      this.#logger?.debug('ToVideoCommand: sticker ditemukan tetapi bukan animasi');
      throw new BotError(`Sticker ini tidak beranimasi. Gunakan *${this.#prefix}toimg* untuk mengubahnya menjadi gambar.`);
    }

    this.#logger?.debug('ToVideoCommand: mengunduh sticker animasi...');
    await ctx.react('⏳');
    const webp = await ctx.download(media);
    this.#logger?.debug(
      `ToVideoCommand: unduhan selesai (${(webp.length / 1024).toFixed(1)} KB), mengonversi animated WebP ke MP4...`,
    );
    const mp4 = await this.#converter.animatedWebpToMp4(webp, { background: this.#background });
    this.#logger?.debug(`ToVideoCommand: konversi selesai (${(mp4.length / 1024).toFixed(1)} KB), mengirim video/GIF...`);

    await ctx.sendGif(mp4, '🎬 Sticker animasi ➜ video');
    await ctx.react('✅');
  }
}
