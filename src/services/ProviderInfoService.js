const joinParts = (...parts) => parts.filter(Boolean).join(' ') || null;

/** Daftar penyedia lookup IP; dicoba berurutan sampai ada yang berhasil. */
const PROVIDERS = Object.freeze([
  {
    url: 'https://ipwho.is/',
    parse: (data) =>
      data.success === false
        ? null
        : {
            ip: data.ip,
            region: joinParts(data.city, data.country_code),
            isp: joinParts(data.connection?.asn && `AS${data.connection.asn}`, data.connection?.org || data.connection?.isp),
          },
  },
  {
    url: 'http://ip-api.com/json/?fields=status,city,countryCode,isp,as,query',
    parse: (data) =>
      data.status !== 'success'
        ? null
        : { ip: data.query, region: joinParts(data.city, data.countryCode), isp: data.as || data.isp || null },
  },
]);

/** Info IP publik, wilayah, dan ISP server. Hasil di-cache agar tidak kena rate limit. */
export class ProviderInfoService {
  #cacheMs;
  #timeoutMs;
  #fetch;
  #now;
  #cache = null;
  #pendingLookup = null;

  constructor({ cacheMs, timeoutMs, fetchImpl = globalThis.fetch, now = Date.now }) {
    this.#cacheMs = cacheMs;
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
    this.#now = now;
  }

  /** Pre-warm cache saat startup agar pemanggilan .ping pertama tidak menunggu request jaringan. */
  async prewarm() {
    try {
      await this.lookup();
    } catch {
      /* diabaikan */
    }
  }

  /** @returns {Promise<{ip: string, region: string|null, isp: string|null}|null>} */
  async lookup() {
    if (this.#cache && this.#cache.expiresAt > this.#now()) return this.#cache.value;
    if (this.#pendingLookup) return this.#pendingLookup;

    this.#pendingLookup = (async () => {
      for (const provider of PROVIDERS) {
        const value = await this.#tryProvider(provider);
        if (value) {
          this.#cache = { value, expiresAt: this.#now() + this.#cacheMs };
          return value;
        }
      }
      return this.#cache?.value ?? null; // data lama lebih baik daripada kosong
    })().finally(() => {
      this.#pendingLookup = null;
    });

    return this.#pendingLookup;
  }

  async #tryProvider({ url, parse }) {
    try {
      const response = await this.#fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!response.ok) return null;

      const parsed = parse(await response.json());
      return parsed?.ip ? parsed : null;
    } catch {
      return null;
    }
  }
}
