import { BaseCommand } from './BaseCommand.js';

const MEDIA_TYPES = Object.freeze(['imageMessage', 'videoMessage', 'stickerMessage']);
const HELP_ARGS = new Set(['help', 'menu', '?']);

/** Strategy interface implementations for converting media into stickers. */
export class ImageStickerStrategy {
  create(factory, buffer, meta) {
    return factory.fromImage(buffer, meta);
  }
}

export class VideoStickerStrategy {
  create(factory, buffer, meta, media) {
    const duration = Number(media?.node?.seconds ?? 0);
    return factory.fromVideo(buffer, meta, { duration });
  }
}

export class StickerRecreationStrategy {
  create(factory, buffer, meta) {
    return factory.fromSticker(buffer, meta);
  }
}

const DEFAULT_STRATEGIES = Object.freeze({
  imageMessage: new ImageStickerStrategy(),
  videoMessage: new VideoStickerStrategy(),
  stickerMessage: new StickerRecreationStrategy(),
});

export class StickerCommand extends BaseCommand {
  #factory;
  #metaParser;
  #maxSeconds;
  #prefix;
  #strategies;
  #logger;

  constructor({ stickerFactory, metaParser, maxSeconds, prefix, strategies = DEFAULT_STRATEGIES, logger = null }) {
    super({
      name: 'sticker',
      aliases: ['s'],
      description: 'Ubah gambar/video menjadi sticker',
    });
    this.#factory = stickerFactory;
    this.#metaParser = metaParser;
    this.#maxSeconds = maxSeconds;
    this.#prefix = prefix;
    this.#strategies = strategies;
    this.#logger = logger;
  }

  async execute(ctx, args) {
    const media = ctx.findMedia(MEDIA_TYPES);

    if (!media || HELP_ARGS.has(args.toLowerCase())) {
      this.#logger?.debug(
        `StickerCommand: ${!media ? 'tidak ada media gambar/video/sticker yang ditemukan' : 'argumen bantuan diminta'} (${ctx?.senderLabel ?? 'unknown'})`,
      );
      ctx.react('❓');
      await ctx.reply(this.#helpText());
      return;
    }

    const meta = this.#metaParser.parse(args, ctx.pushName); // validasi sebelum kerja berat
    const duration = Number(media.node.seconds ?? 0);
    const wasTrimmed = media.type === 'videoMessage' && duration > this.#maxSeconds;

    this.#logger?.debug(
      `StickerCommand: memproses media tipe=${media.type}, durasi=${duration}s (trim=${wasTrimmed}), pack="${meta.pack}", author="${meta.author}"`,
    );

    ctx.react('⏳');
    const buffer = await ctx.download(media);
    this.#logger?.debug(`StickerCommand: unduhan media selesai (${(buffer.length / 1024).toFixed(1)} KB)`);

    const strategy = this.#strategies[media.type] ?? this.#strategies.imageMessage;
    const sticker = await strategy.create(this.#factory, buffer, meta, media);
    this.#logger?.debug(`StickerCommand: pembuatan sticker selesai (${(sticker.length / 1024).toFixed(1)} KB), mengirim...`);

    await ctx.sendSticker(sticker);
    ctx.react('✅');

    if (meta.custom || wasTrimmed) {
      await ctx.reply(this.#summary(meta, wasTrimmed));
    }
  }

  #summary({ pack, author }, wasTrimmed) {
    const lines = [
      '✅ *Sticker berhasil dibuat!*',
      '',
      `📦 Pack   : ${pack}`,
      `✍️ Author : ${author}`,
    ];
    if (wasTrimmed) {
      lines.push('', `✂️ _Video otomatis dipotong ke ${this.#maxSeconds} detik._`);
    }
    return lines.join('\n');
  }

  #helpText() {
    const p = this.#prefix;
    return [
      '✨ *STICKER MAKER*',
      '',
      'Kirim atau *reply* gambar / video / *sticker* dengan perintah:',
      '',
      `┌ *${p}sticker* atau *${p}s*`,
      '│ Sticker dengan pack default',
      `├ *${p}s NamaPack|NamaAuthor*`,
      '│ Sticker dengan pack & author kustom',
      `├ *${p}s NamaPack*`,
      '│ Ganti nama pack saja',
      `└ *${p}s |NamaAuthor*`,
      '  Ganti author saja',
      '',
      `💡 Contoh: *${p}s Koleksi Lucu|Budi*`,
      '♻️ Reply sticker (biasa maupun animasi) untuk dibuat ulang dengan pack & author baru.',
      `🎞️ Video maks *${this.#maxSeconds} detik* (otomatis dipotong).`,
      '',
      `🔁 Lainnya: *${p}toimg* · *${p}tovid*`,
    ].join('\n');
  }
}
