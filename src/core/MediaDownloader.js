import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { BotError } from '../errors/BotError.js';
import { baileysLogger } from './baileysLogger.js';

/**
 * Bertanggung jawab mengunduh media dari Baileys dengan pengecekan batas ukuran (SRP: Media Downloader).
 */
export class MediaDownloader {
  #sock;
  #maxInputBytes;
  #logger;

  constructor({ sock, maxInputBytes, logger = null }) {
    this.#sock = sock;
    this.#maxInputBytes = maxInputBytes;
    this.#logger = logger;
  }

  async download(media, { failureMessage = 'Gagal mengunduh media. Coba kirim ulang medianya.', maxRetries = 2 } = {}) {
    const size = Number(media.node?.fileLength ?? 0);
    const sizeText = size > 0 ? `${(size / 1024).toFixed(1)} KB` : 'ukuran tidak diketahui';
    this.#logger?.debug(`MediaDownloader: mengunduh media ${media.type} (${sizeText})...`);

    if (size > this.#maxInputBytes) {
      const limitMb = Math.round(this.#maxInputBytes / 1024 / 1024);
      this.#logger?.debug(`MediaDownloader: unduhan ditolak, ukuran (${sizeText}) melebihi batas ${limitMb} MB`);
      throw new BotError(`File terlalu besar (maks ${limitMb} MB).`);
    }

    let lastError;
    // Retry singkat untuk error jaringan transient (DNS/time-out) sebelum gagalkan command.
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        this.#logger?.debug(`MediaDownloader: mencoba ulang unduhan (percobaan ${attempt + 1}/${maxRetries + 1})...`);
      }
      try {
        const buffer = await downloadMediaMessage(
          { key: media.key, message: { [media.type]: media.node } },
          'buffer',
          {},
          { logger: baileysLogger, reuploadRequest: this.#sock?.updateMediaMessage ? this.#sock.updateMediaMessage.bind(this.#sock) : undefined },
        );
        // Verifikasi ukuran aktual pasca-unduh: metadata fileLength berasal dari pengirim
        // dan bisa dipalsukan (vektor media-bomb), jadi tidak boleh jadi satu-satunya gerbang.
        if (buffer.length > this.#maxInputBytes) {
          const limitMb = Math.round(this.#maxInputBytes / 1024 / 1024);
          this.#logger?.debug(
            `MediaDownloader: unduhan ditolak pasca-verifikasi, ukuran aktual (${(buffer.length / 1024 / 1024).toFixed(1)} MB) melebihi batas ${limitMb} MB`,
          );
          throw new BotError(`File terlalu besar (maks ${limitMb} MB).`);
        }
        this.#logger?.debug(`MediaDownloader: unduhan media ${media.type} berhasil (${(buffer.length / 1024).toFixed(1)} KB)`);
        return buffer;
      } catch (error) {
        lastError = error;
        // BotError (batas ukuran) = kegagalan final, tidak perlu di-retry.
        if (error instanceof BotError) throw error;
        this.#logger?.debug(`MediaDownloader: unduhan media ${media.type} gagal (percobaan ${attempt + 1}): ${error?.message || error}`);
      }
    }
    throw new BotError(failureMessage, { cause: lastError });
  }
}
