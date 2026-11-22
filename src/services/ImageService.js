import sharp from 'sharp';
import { BotError } from '../errors/BotError.js';
import { buildBratSvg, buildMemeSvg } from '../utils/textSvgGenerator.js';

/** Operasi gambar/WebP berbasis sharp. */
export class ImageService {
  /** Gambar apa pun -> WebP 512x512 dengan latar transparan (rasio dijaga). */
  async toStickerWebp(buffer, { size, quality }) {
    return this.#guard(() =>
      sharp(buffer, { failOn: 'none' })
        .rotate()
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality, effort: 4 })
        .toBuffer(),
    );
  }

  /** WebP (statis/animasi) -> PNG. Untuk animasi, diambil frame pertama (seperti thumbnail). */
  async toPng(webp) {
    return this.#guard(() => sharp(webp, { animated: false }).png().toBuffer());
  }

  /** Animated WebP -> GIF, transparansi diratakan ke `background`. */
  async animatedToGif(webp, background) {
    return this.#guard(() =>
      sharp(webp, { animated: true }).flatten({ background }).gif({ effort: 1 }).toBuffer(),
    );
  }

  /**
   * Membuat stiker meme 512x512 dari gambar/stiker sumber dengan teks atas & bawah bergaya Impact.
   */
  async createMeme(buffer, { topText = '', bottomText = '', size = 512, quality = 80 } = {}) {
    return this.#guard(async () => {
      const img = sharp(buffer, { failOn: 'none', animated: false }).rotate();
      const meta = await img.metadata();
      const origWidth = meta.width && meta.width > 0 ? meta.width : size;
      const origHeight = meta.height && meta.height > 0 ? meta.height : size;

      const svgText = buildMemeSvg({ topText, bottomText, origWidth, origHeight, size });
      const resizedBase = await img
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .toBuffer();

      return sharp(resizedBase)
        .composite([
          {
            input: Buffer.from(svgText),
            top: 0,
            left: 0,
          },
        ])
        .webp({ quality, effort: 4 })
        .toBuffer();
    });
  }

  /**
   * Membuat stiker viral Brat 512x512 berbasis render lokal SVG murni.
   */
  async createBrat(text, { isWhite = false, size = 512, quality = 85 } = {}) {
    return this.#guard(async () => {
      const svg = buildBratSvg({ text, isWhite, size });
      return sharp(Buffer.from(svg))
        .webp({ quality, effort: 4 })
        .toBuffer();
    });
  }

  async #guard(task) {
    try {
      return await task();
    } catch (error) {
      if (error instanceof BotError) throw error;
      throw new BotError('Gagal membaca media. Format tidak didukung atau file rusak.', { cause: error });
    }
  }
}
