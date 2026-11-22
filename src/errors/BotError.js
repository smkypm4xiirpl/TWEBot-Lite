/**
 * Error yang aman ditampilkan ke pengguna (pesan sudah ramah).
 * Error lain dianggap internal dan hanya dicatat di log.
 */
export class BotError extends Error {
  constructor(userMessage, { cause } = {}) {
    super(userMessage, cause ? { cause } : undefined);
    this.name = 'BotError';
  }

  get userMessage() {
    return this.message;
  }
}
