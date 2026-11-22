import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withTempDir } from '../utils/withTempDir.js';

import { ImageService } from './ImageService.js';

/** Kumpulan konversi berbasis FFmpeg (hanya tahu argumen, bukan alur bisnis). */
export class MediaConverter {
  #ffmpeg;
  #images;
  #logger;

  constructor({ ffmpeg, images = null, logger = null }) {
    this.#ffmpeg = ffmpeg;
    this.#images = images ?? new ImageService();
    this.#logger = logger;
  }

  /** Video -> animated WebP 512x512 transparan, otomatis dipotong `maxSeconds`. */
  videoToAnimatedWebp(input, output, { size, maxSeconds, fps, quality }) {
    this.#logger?.debug(
      `MediaConverter: video -> animated WebP (size=${size}, maxSec=${maxSeconds}, fps=${fps}, quality=${quality})`,
    );

    const filters = [
      `fps=${fps}`,
      `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
      'format=rgba',
      `pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
    ].join(',');

    return this.#ffmpeg.run([
      '-t', String(maxSeconds),
      '-i', input,
      '-an',
      '-vf', filters,
      '-c:v', 'libwebp',
      '-lossless', '0',
      '-q:v', String(quality),
      '-compression_level', '4',
      '-preset', 'default',
      '-loop', '0',
      output,
    ]);
  }

  /** Static WebP -> MP4 (H.264) direct single-pass dengan latar belakang solid. */
  webpToMp4(input, output, { background = '#ffffff' } = {}) {
    this.#logger?.debug(`MediaConverter: static WebP -> MP4 (background=${background})`);

    return this.#ffmpeg.run([
      '-i', input,
      '-an',
      '-filter_complex', `[0:v]format=rgba,split[a][b];[a]drawbox=c=${background}:t=fill[bg];[bg][b]overlay=format=auto,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      output,
    ]);
  }

  /**
   * Animated WebP -> MP4 (H.264).
   * FFmpeg native decoder tidak mendukung animasi WebP (ANIM/ANMF chunks).
   * Konversi cepat via Sharp animatedToGif (effort: 1) lalu encode ke MP4 via FFmpeg.
   * Temp file I/O sepenuhnya diisolasi di service layer.
   */
  async animatedWebpToMp4(webpBuffer, { background = '#ffffff' } = {}) {
    this.#logger?.debug(
      `MediaConverter: konversi animated WebP -> MP4 dimulai (ukuran input: ${(webpBuffer.length / 1024).toFixed(1)} KB)`,
    );
    const gifBuffer = await this.#images.animatedToGif(webpBuffer, background);
    this.#logger?.debug(
      `MediaConverter: Sharp konversi ke GIF berhasil (${(gifBuffer.length / 1024).toFixed(1)} KB), memulai FFmpeg gifToMp4...`,
    );

    return withTempDir(async (dir) => {
      const input = path.join(dir, 'temp.gif');
      const output = path.join(dir, 'output.mp4');
      await writeFile(input, gifBuffer);
      await this.gifToMp4(input, output);
      const result = await readFile(output);
      this.#logger?.debug(`MediaConverter: konversi MP4 selesai (${(result.length / 1024).toFixed(1)} KB)`);
      return result;
    });
  }

  /** GIF -> MP4 (H.264) yang kompatibel dengan WhatsApp. */
  gifToMp4(input, output) {
    this.#logger?.debug('MediaConverter: FFmpeg gifToMp4 dieksekusi');

    return this.#ffmpeg.run([
      '-i', input,
      '-an',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      output,
    ]);
  }
}
