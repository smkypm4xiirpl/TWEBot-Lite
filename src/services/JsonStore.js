import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function renameWithRetry(oldPath, newPath, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await rename(oldPath, newPath);
      return;
    } catch (err) {
      if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }
      // On Windows or cross-device rename issues, fallback to copyFile + unlink
      try {
        await copyFile(oldPath, newPath);
        await unlink(oldPath).catch(() => {});
        return;
      } catch {
        throw err;
      }
    }
  }
}

/** Penyimpanan JSON sederhana: tulis atomik (tmp + rename) dan antrean tulis berurutan. */
export class JsonStore {
  #file;
  #logger;
  #aliases;
  #queue = Promise.resolve();

  constructor(file, { logger = null, aliases = [] } = {}) {
    this.#file = file;
    this.#logger = logger;

    const resolvedPrimary = path.resolve(file);
    const rawAliases = Array.isArray(aliases) ? aliases : [aliases];
    const uniqueMap = new Map();

    for (const a of rawAliases) {
      if (typeof a === 'string' && a.trim()) {
        const clean = a.trim();
        const resolved = path.resolve(clean);
        if (resolved !== resolvedPrimary && !uniqueMap.has(resolved)) {
          uniqueMap.set(resolved, clean);
        }
      }
    }

    this.#aliases = [...uniqueMap.values()];
  }

  get file() {
    return this.#file;
  }

  get aliases() {
    return [...this.#aliases];
  }

  async load(fallback, validator = null) {
    const candidates = [this.#file, ...this.#aliases];
    for (const candidate of candidates) {
      try {
        const raw = await readFile(candidate, 'utf8');
        const trimmed = raw.trim();
        if (!trimmed) {
          // File kosong (0 byte / spasi) dilewati tanpa dianggap korup
          continue;
        }
        const parsed = JSON.parse(trimmed);
        if (typeof validator === 'function' && !validator(parsed)) {
          // Gagal validator (misal obyek kosong tanpa data target), lanjut cek kandidat berikutnya
          continue;
        }
        return parsed;
      } catch (error) {
        if (error.code === 'ENOENT') {
          continue;
        }
        if (error instanceof SyntaxError) {
          const backup = `${candidate}.corrupt-${Date.now()}`;
          await renameWithRetry(candidate, backup).catch(() => {});
          this.#logger?.warn(`File ${path.basename(candidate)} rusak, dicadangkan ke ${path.basename(backup)}.`);
          continue;
        }
        throw error;
      }
    }
    return fallback;
  }

  save(data) {
    this.#queue = this.#queue.catch(() => {}).then(() => this.#writeAll(data));
    return this.#queue;
  }

  async #writeAll(data) {
    await this.#writeFile(this.#file, data);
    for (const alias of this.#aliases) {
      try {
        await this.#writeFile(alias, data);
      } catch (err) {
        this.#logger?.warn(`Gagal sinkronisasi alias store ${path.basename(alias)}: ${err.message}`);
      }
    }
  }

  async #writeFile(targetFile, data) {
    await mkdir(path.dirname(targetFile), { recursive: true });
    const temp = `${targetFile}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
      await renameWithRetry(temp, targetFile);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }
}
