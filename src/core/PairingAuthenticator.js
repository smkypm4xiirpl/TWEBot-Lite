import { createInterface } from 'node:readline/promises';

const PHONE_PATTERN = /^[1-9]\d{7,14}$/;
// Alfabet kode pairing WhatsApp (Crockford): 1-9 dan A-Z tanpa I, O, U.
const CODE_PATTERN = /^[1-9A-HJ-NP-TV-Z]{8}$/;

/** Mengembalikan nomor internasional bersih (hanya digit) atau null bila tidak valid. */
export function normalizePhoneNumber(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return PHONE_PATTERN.test(digits) ? digits : null;
}

/** Mengembalikan kode pairing kustom (8 karakter, uppercase) atau null bila tidak valid. */
export function normalizePairingCode(raw) {
  const code = String(raw ?? '').replace(/[\s-]/g, '').toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

async function readlinePrompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * Login via pairing code: mengumpulkan nomor WA (dari .env atau prompt),
 * kode kustom opsional, lalu meminta & menampilkan kode ke console.
 */
export class PairingAuthenticator {
  #logger;
  #prompt;
  #interactive;
  #phone;
  #customCode;
  #requested = false;

  constructor({
    logger,
    phoneNumber = null,
    customCode = null,
    prompt = readlinePrompt,
    interactive = Boolean(process.stdin.isTTY),
  }) {
    this.#logger = logger;
    this.#prompt = prompt;
    this.#interactive = interactive;
    this.#phone = this.#validateConfigured(phoneNumber, normalizePhoneNumber, 'PAIRING_NUMBER', 'berisi 8-15 digit format internasional tanpa 0 di depan, contoh 628123456789');
    this.#customCode = this.#validateConfigured(customCode, normalizePairingCode, 'PAIRING_CODE', 'harus tepat 8 karakter: angka 1-9 dan huruf A-Z tanpa I, O, U');
  }

  /** Lengkapi input yang belum ada. Aman dipanggil berulang. */
  async prepare() {
    if (!this.#phone) {
      this.#assertInteractive('PAIRING_NUMBER');
      this.#phone = await this.#ask(
        '📱 Masukkan nomor WhatsApp bot (contoh 628123456789): ',
        normalizePhoneNumber,
        'Nomor tidak valid. Gunakan format internasional tanpa + dan tanpa 0 di depan.',
      );
    }

    if (!this.#customCode && this.#interactive) {
      this.#customCode = await this.#ask(
        '🔑 Kode pairing kustom (8 karakter, Enter untuk acak): ',
        normalizePairingCode,
        'Kode tidak valid. Harus 8 karakter: angka 1-9 dan huruf A-Z tanpa I, O, U.',
        { optional: true },
      );
    }
  }

  /** Izinkan permintaan kode baru (dipanggil setiap socket baru dibuat). */
  reset() {
    this.#requested = false;
  }

  async request(sock) {
    if (this.#requested) return;
    this.#requested = true;

    try {
      const code = await sock.requestPairingCode(this.#phone, this.#customCode ?? undefined);
      this.#logger.pairingCode({ phone: this.#phone, code, custom: Boolean(this.#customCode) });
    } catch (error) {
      this.#requested = false;
      this.#logger.error('Gagal meminta kode pairing', error);
    }
  }

  #validateConfigured(value, normalize, name, hint) {
    if (!value) return null;
    const normalized = normalize(value);
    if (!normalized) {
      throw new Error(`${name} tidak valid: ${hint}.`);
    }
    return normalized;
  }

  #assertInteractive(envName) {
    if (!this.#interactive) {
      throw new Error(`Belum login dan terminal tidak interaktif. Set ${envName} di .env (atau jalankan di terminal biasa).`);
    }
  }

  async #ask(question, normalize, errorMessage, { optional = false } = {}) {
    for (;;) {
      const answer = (await this.#prompt(question)).trim();
      if (!answer && optional) return null;

      const value = normalize(answer);
      if (value) return value;
      this.#logger.warn(errorMessage);
    }
  }
}
