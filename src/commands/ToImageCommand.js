import { BaseCommand } from './BaseCommand.js';

export class ToImageCommand extends BaseCommand {
  #images;
  #prefix;
  #logger;

  constructor({ images, prefix, logger = null }) {
    super({ name: 'toimg', aliases: ['toimage'], description: 'Ubah sticker menjadi gambar' });
    this.#images = images;
    this.#prefix = prefix;
    this.#logger = logger;
  }

  async execute(ctx) {
    const media = ctx.findMedia(['stickerMessage']);

    if (!media) {
      this.#logger?.debug('ToImageCommand: tidak ada sticker yang di-reply/ditemukan');
      await ctx.react('❓');
      await ctx.reply(
        [
          '🖼️ *STICKER ➜ GAMBAR*',
          '',
          `Reply sebuah sticker dengan *${this.#prefix}toimg*.`,
          '_Sticker animasi akan diambil frame pertamanya sebagai gambar._',
        ].join('\n'),
      );
      return;
    }

    this.#logger?.debug(`ToImageCommand: mengunduh sticker (${media.node?.isAnimated ? 'animasi' : 'statis'})...`);
    await ctx.react('⏳');
    const webp = await ctx.download(media);
    this.#logger?.debug(`ToImageCommand: unduhan selesai (${(webp.length / 1024).toFixed(1)} KB), mengonversi ke PNG...`);
    const png = await this.#images.toPng(webp);
    this.#logger?.debug(`ToImageCommand: konversi PNG selesai (${(png.length / 1024).toFixed(1)} KB), mengirim gambar...`);

    const caption = media.node.isAnimated
      ? '🖼️ Sticker animasi ➜ gambar (frame pertama)'
      : '🖼️ Sticker ➜ gambar';
    await ctx.sendImage(png, caption);
    await ctx.react('✅');
  }
}
