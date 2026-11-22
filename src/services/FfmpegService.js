import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { BotError } from '../errors/BotError.js';
import { Semaphore } from '../utils/Semaphore.js';

const execFileAsync = promisify(execFile);

/** Runner FFmpeg tipis: eksekusi aman, dibatasi concurrency & timeout. */
export class FfmpegService {
  #binary;
  #limiter;

  constructor({ binaryPath = null, concurrency = 2 } = {}) {
    this.#binary = binaryPath ?? ffmpegStatic;
    this.#limiter = new Semaphore(concurrency);
  }

  /** Dipanggil saat boot agar masalah FFmpeg terdeteksi lebih awal. */
  async version() {
    if (!this.#binary) {
      throw new Error('Binary FFmpeg tidak ditemukan. Set FFMPEG_PATH atau install ffmpeg-static.');
    }
    const { stdout } = await execFileAsync(this.#binary, ['-version']);
    return stdout.split('\n')[0].replace('ffmpeg version ', '').split(' ')[0];
  }

  run(args, { timeoutMs = 90_000 } = {}) {
    return this.#limiter.run(async () => {
      try {
        await execFileAsync(this.#binary, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
          timeout: timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
        });
      } catch (error) {
        const message = error.killed
          ? 'Proses konversi terlalu lama dan dibatalkan.'
          : 'Gagal memproses media. Pastikan file tidak rusak.';
        throw new BotError(message, { cause: error });
      }
    });
  }
}
