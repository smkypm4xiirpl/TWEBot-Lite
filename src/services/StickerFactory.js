import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BotError } from '../errors/BotError.js';
import { withTempDir } from '../utils/withTempDir.js';

/** Membuat sticker WebP (lengkap dengan metadata) dari gambar atau video. */
export class StickerFactory {
  #converter;
  #images;
  #exif;
  #options;
  #logger;

  constructor({ converter, images, exif, options, logger = null }) {
    this.#converter = converter;
    this.#images = images;
    this.#exif = exif;
    this.#options = options;
    this.#logger = logger;
  }

  async fromImage(buffer, meta) {
    const { size, imageQuality } = this.#options;
    this.#logger?.debug(`StickerFactory: membuat sticker gambar (size=${size}, quality=${imageQuality})`);
    const webp = await this.#images.toStickerWebp(buffer, { size, quality: imageQuality });
    return this.#exif.embed(webp, meta);
  }

  /** Sticker (statis/animasi) -> sticker baru: cukup tulis ulang metadata, tanpa re-encode. */
  async fromSticker(buffer, meta) {
    try {
      this.#logger?.debug('StickerFactory: membuat ulang sticker dari sticker yang di-reply (re-embed metadata)');
      return await this.#exif.embed(buffer, meta);
    } catch (error) {
      throw new BotError('Sticker tidak dapat diproses. Pastikan yang di-reply adalah sticker yang valid.', { cause: error });
    }
  }

  async fromVideo(buffer, meta, { duration = 0 } = {}) {
    this.#logger?.debug(`StickerFactory: membuat sticker video (durasi=${duration}s)`);
    const webp = await withTempDir(async (dir) => {
      const input = path.join(dir, 'input.bin');
      const output = path.join(dir, 'output.webp');
      await writeFile(input, buffer);
      await this.#encodeWithinLimit(input, output, duration);
      return readFile(output);
    });
    return this.#exif.embed(webp, meta);
  }

  /** Turunkan kualitas/fps bertahap sampai ukuran muat di batas WhatsApp. */
  async #encodeWithinLimit(input, output, duration = 0) {
    const { size, maxSeconds, maxBytes, videoEncodeSteps } = this.#options;

    // Jika durasi video > 5 detik, lewati langkah 1 (15fps) agar langsung menghemat komputasi dan ukuran
    const steps = duration > 5 ? videoEncodeSteps.slice(1) : videoEncodeSteps;

    for (const { quality, fps } of steps) {
      this.#logger?.debug(`StickerFactory: mencoba encode video (quality=${quality}, fps=${fps})`);
      await this.#converter.videoToAnimatedWebp(input, output, { size, maxSeconds, fps, quality });
      const currentSize = (await stat(output)).size;
      this.#logger?.debug(
        `StickerFactory: ukuran hasil WebP = ${(currentSize / 1024).toFixed(1)} KB (target <= ${(maxBytes / 1024).toFixed(1)} KB)`,
      );
      if (currentSize <= maxBytes) return;
    }

    throw new BotError('Hasil sticker terlalu besar untuk WhatsApp. Coba video yang lebih sederhana atau lebih pendek.');
  }
}
