const MEDIA_TYPES = Object.freeze(['imageMessage', 'videoMessage', 'audioMessage']);

/**
 * Menyimpan referensi media view-once yang diterima bot (bukan isinya).
 * WhatsApp sering membuang data media pada kutipan setelah pesan dibuka, jadi `.avo`
 * memakai referensi yang dicatat saat pesan aslinya masuk. Memakai LRU + TTL.
 */
export class ViewOnceCache {
  #entries = new Map();
  #max;
  #ttlMs;
  #now;

  constructor({ max, ttlMs, now = Date.now }) {
    this.#max = max;
    this.#ttlMs = ttlMs;
    this.#now = now;
  }

  remember(ctx) {
    if (!ctx?.jid || !ctx?.messageId) return;
    const ref = ctx.findMedia(MEDIA_TYPES, { scope: 'own' });
    if (!ref?.viewOnce) return;

    const key = this.#key(ctx.jid, ctx.messageId);
    this.#entries.delete(key);
    this.#entries.set(key, { ref, expiresAt: this.#now() + this.#ttlMs });
    this.#evict();
  }

  /** Ambil referensi untuk pesan yang sedang di-reply (atau null). */
  recall(ctx) {
    if (!ctx?.quotedId || !ctx?.jid) return null;

    const key = this.#key(ctx.jid, ctx.quotedId);
    const entry = this.#entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return null;
    }
    // Refresh posisi LRU
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.ref;
  }

  get size() {
    return this.#entries.size;
  }

  #evict() {
    const now = this.#now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) {
        this.#entries.delete(key);
      }
    }
    while (this.#entries.size > this.#max) {
      const oldestKey = this.#entries.keys().next().value;
      this.#entries.delete(oldestKey);
    }
  }

  #key(jid, id) {
    return `${jid}|${id}`;
  }
}
