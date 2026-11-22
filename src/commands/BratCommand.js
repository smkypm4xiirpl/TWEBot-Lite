import { BaseCommand } from './BaseCommand.js';

const HELP_ARGS = new Set(['help', 'menu', '?', '--help', '-h']);

/**
 * Command untuk membuat stiker teks viral Brat ala Charli XCX
 * dengan latar hijau neon khas (#8ACE00) atau latar putih edisi deluxe (#FFFFFF).
 */
export class BratCommand extends BaseCommand {
  #images;
  #exif;
  #prefix;
  #stickerConfig;
  #logger;

  constructor({ images, exif, prefix = '.', stickerConfig = null, logger = null } = {}) {
    super({
      name: 'brat',
      aliases: ['bratgenerator'],
      description: 'Buat stiker teks viral estetik Brat',
    });
    this.#images = images;
    this.#exif = exif;
    this.#prefix = prefix;
    this.#stickerConfig = stickerConfig;
    this.#logger = logger;
  }

  async execute(ctx, args = '') {
    const rawArgs = (args ?? '').trim();

    if (!rawArgs || HELP_ARGS.has(rawArgs.toLowerCase())) {
      this.#logger?.debug(`BratCommand: argumen kosong atau bantuan diminta (${ctx?.senderLabel ?? 'unknown'})`);
      await ctx.react('❓');
      await ctx.reply(this.#helpText());
      return;
    }

    // Ekstraksi flag warna putih (-w atau --white)
    let isWhite = false;
    let cleanedText = rawArgs;
    if (/(?:^|\s)(?:--white|-w)(?=\s|$)/i.test(cleanedText)) {
      isWhite = true;
      cleanedText = cleanedText.replace(/(?:^|\s)(?:--white|-w)(?=\s|$)/gi, ' ').trim();
    }
    cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

    if (!cleanedText) {
      this.#logger?.debug(`BratCommand: teks kosong setelah flag dibersihkan (${ctx?.senderLabel ?? 'unknown'})`);
      await ctx.react('❓');
      await ctx.reply(this.#helpText());
      return;
    }

    this.#logger?.debug(
      `BratCommand: memproses stiker brat (isWhite=${isWhite}, text="${cleanedText}") untuk ${ctx?.senderLabel ?? 'unknown'}`,
    );

    await ctx.react('⏳');

    const size = this.#stickerConfig?.size ?? 512;
    const quality = this.#stickerConfig?.imageQuality ?? 85;

    const webp = await this.#images.createBrat(cleanedText, {
      isWhite,
      size,
      quality,
    });

    const pack = this.#stickerConfig?.defaultPack || 'Sticker Bot';
    const author = this.#stickerConfig?.defaultAuthor || ctx.pushName || pack;

    const sticker = await this.#exif.embed(webp, { pack, author });
    this.#logger?.debug(`BratCommand: stiker selesai (${(sticker.length / 1024).toFixed(1)} KB), mengirim...`);

    await ctx.sendSticker(sticker);
    await ctx.react('✅');
  }

  #helpText() {
    const p = this.#prefix;
    return [
      '🟩 *VIRAL BRAT STICKER GENERATOR*',
      '_Bikin stiker teks estetik ala album Brat Charli XCX!_',
      '',
      '╭─ 📌 *CARA PENGGUNAAN*',
      `├── *${p}brat <teks>*`,
      '│   _Latar hijau neon khas Brat (#8ACE00)_',
      `└── *${p}brat -w <teks>* atau *${p}brat --white <teks>*`,
      '    _Latar putih edisi deluxe (#FFFFFF)_',
      '╰────────────────────────',
      '',
      '╭─ 💡 *CONTOH*',
      `├── \`${p}brat so julia\``,
      `├── \`${p}brat and it's the same but there's three more songs so it's not\``,
      `├── \`${p}brat -w kamu nanya\``,
      `└── \`${p}brat cape banget ngoding\``,
      '╰────────────────────────',
      '⚡ _Instan render ~30ms tanpa loading lama!_',
    ].join('\n');
  }
}
