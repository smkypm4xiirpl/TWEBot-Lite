import { BaseCommand } from './BaseCommand.js';

const MEDIA_TYPES = Object.freeze(['imageMessage', 'stickerMessage']);
const HELP_ARGS = new Set(['help', 'menu', '?', '--help', '-h']);

/**
 * Command untuk membuat stiker meme klasik (teks Impact atas & bawah)
 * dari gambar atau stiker yang dikirim/di-reply.
 */
export class SmemeCommand extends BaseCommand {
  #images;
  #exif;
  #prefix;
  #stickerConfig;
  #logger;

  constructor({ images, exif, prefix = '.', stickerConfig = null, logger = null } = {}) {
    super({
      name: 'smeme',
      aliases: ['stickermeme', 'sm'],
      description: 'Buat stiker meme dengan teks atas & bawah',
    });
    this.#images = images;
    this.#exif = exif;
    this.#prefix = prefix;
    this.#stickerConfig = stickerConfig;
    this.#logger = logger;
  }

  async execute(ctx, args = '') {
    const trimmed = (args ?? '').trim();
    const isHelp = HELP_ARGS.has(trimmed.toLowerCase());

    // Validasi bantuan awal
    if (isHelp) {
      this.#logger?.debug(`SmemeCommand: bantuan diminta oleh ${ctx?.senderLabel ?? 'unknown'}`);
      await ctx.react('❓');
      await ctx.reply(this.#helpText());
      return;
    }

    // Cari media gambar atau stiker (baik langsung pada pesan maupun pada pesan yang di-reply)
    const media = ctx.findMedia(MEDIA_TYPES);

    // Jika tanpa argumen atau tanpa media, tampilkan panduan estetis UI/UX
    if (!trimmed || !media) {
      this.#logger?.debug(
        `SmemeCommand: ${!media ? 'tidak ada media yang ditemukan' : 'argumen teks kosong'} (${ctx?.senderLabel ?? 'unknown'})`,
      );
      await ctx.react('❓');
      await ctx.reply(this.#helpText());
      return;
    }

    // Parsing teks: mendukung teks tunggal atau dua bagian dipisah '|'
    let topText = '';
    let bottomText = '';

    if (trimmed.includes('|')) {
      const parts = trimmed.split('|');
      topText = parts[0].trim();
      bottomText = parts.slice(1).join('|').trim();
    } else {
      // Default teks tunggal menjadi teks bawah (punchline klasik meme)
      bottomText = trimmed;
    }

    if (!topText && !bottomText) {
      await ctx.react('❓');
      await ctx.reply(this.#helpText());
      return;
    }

    this.#logger?.debug(
      `SmemeCommand: memproses meme [top="${topText}", bottom="${bottomText}"] dari media ${media.type} (${ctx?.senderLabel ?? 'unknown'})`,
    );

    await ctx.react('⏳');

    const buffer = await ctx.download(media);
    this.#logger?.debug(`SmemeCommand: unduhan media selesai (${(buffer.length / 1024).toFixed(1)} KB)`);

    const size = this.#stickerConfig?.size ?? 512;
    const quality = this.#stickerConfig?.imageQuality ?? 80;

    const webp = await this.#images.createMeme(buffer, {
      topText,
      bottomText,
      size,
      quality,
    });
    this.#logger?.debug(`SmemeCommand: render meme selesai (${(webp.length / 1024).toFixed(1)} KB), menambahkan EXIF...`);

    const pack = this.#stickerConfig?.defaultPack || 'Sticker Bot';
    const author = this.#stickerConfig?.defaultAuthor || ctx.pushName || pack;

    const sticker = await this.#exif.embed(webp, { pack, author });
    this.#logger?.debug(`SmemeCommand: stiker siap dikirim (${(sticker.length / 1024).toFixed(1)} KB)`);

    await ctx.sendSticker(sticker);
    await ctx.react('✅');
  }

  #helpText() {
    const p = this.#prefix;
    return [
      '✨ *SMART MEME STICKER*',
      '_Buat stiker meme kustom dengan gaya teks klasik Impact!_',
      '',
      '╭─ 📌 *CARA PENGGUNAAN*',
      `├── *Kirim gambar/stiker* dengan caption:`,
      `│   \`${p}smeme Teks Atas | Teks Bawah\``,
      `├── *Atau reply* gambar/stiker/view-once:`,
      `│   \`${p}smeme Teks Atas | Teks Bawah\``,
      '╰────────────────────────',
      '',
      '╭─ 💡 *VARIASI TEKS*',
      `├── \`${p}smeme Teks Atas | Teks Bawah\``,
      '│   _Teks atas & teks bawah terpisah_',
      `├── \`${p}smeme | Teks Bawah\``,
      '│   _Hanya teks bawah (punchline)_',
      `├── \`${p}smeme Teks Atas |\``,
      '│   _Hanya teks atas_',
      `└── \`${p}smeme Teks Singkat\``,
      '    _Otomatis menjadi teks bawah_',
      '╰────────────────────────',
      '',
      '╭─ 📝 *CONTOH*',
      `├── \`${p}smeme ketika lu | lupa git pull\``,
      `├── \`${p}smeme santai dulu gak sih\``,
      `└── \`${p}smeme | jangan panik\``,
      '╰────────────────────────',
      '⚡ _Mendukung gambar, stiker biasa, stiker bergerak, dan media view-once._',
    ].join('\n');
  }
}
