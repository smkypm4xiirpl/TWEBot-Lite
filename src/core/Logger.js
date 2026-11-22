import fs from 'node:fs';
import path from 'node:path';

const ANSI = Object.freeze({
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
});

const LEVELS = Object.freeze({
  debug: { label: 'DEBUG', color: 'gray', icon: '·' },
  info: { label: 'INFO ', color: 'cyan', icon: 'ℹ' },
  success: { label: 'OK   ', color: 'green', icon: '✔' },
  warn: { label: 'WARN ', color: 'yellow', icon: '⚠' },
  error: { label: 'ERROR', color: 'red', icon: '✖' },
  command: { label: 'CMD  ', color: 'magenta', icon: '➜' },
});

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (color, text) => (useColor ? `${ANSI[color]}${text}${ANSI.reset}` : text);
const bold = (text) => (useColor ? `${ANSI.bold}${text}${ANSI.reset}` : text);

const FLUSH_INTERVAL_MS = 2000;
const LOG_MAX_BYTES = 10 * 1024 * 1024; // rotasi runtime-logs.txt / errors.txt tiap 10 MB

export class Logger {
  #scope;
  #debugEnabled;

  // Buffer log bersama untuk semua instance Logger (Map: nama file -> array baris)
  static #buffers = new Map();
  static #flushTimer = null;
  static #flushQueue = Promise.resolve();

  constructor(scope = 'app', { debug = ['debug', 'trace'].includes((process.env.LOG_LEVEL || '').trim().toLowerCase()) } = {}) {
    this.#scope = scope;
    this.#debugEnabled = debug;
  }

  child(scope) {
    return new Logger(scope, { debug: this.#debugEnabled });
  }

  get isDebugEnabled() {
    return this.#debugEnabled;
  }

  debug(message) {
    if (this.#debugEnabled) {
      const raw = typeof message === 'function' ? message() : message;
      const text = raw instanceof Error
        ? this.#formatError(raw)
        : (typeof raw === 'object' && raw !== null ? this.#safeString(raw) : raw);
      this.#write('debug', text);
    }
  }

  info(message) {
    this.#write('info', message);
  }

  success(message) {
    this.#write('success', message);
  }

  warn(message) {
    this.#write('warn', message);
  }

  error(message, cause) {
    const detail = cause ? this.#formatError(cause) : '';
    this.#write('error', detail ? `${message}\n${detail}` : message);
    this.#enqueue('errors.txt', `${this.#record('ERROR', message)}${detail ? `\n${detail}` : ''}`);
  }

  /** Log satu baris per eksekusi command. */
  command({ name, sender, chat, status, durationMs }) {
    const result = status === 'ok' ? paint('green', '✔ selesai') : paint('red', '✖ gagal  ');
    const time = paint('gray', `${durationMs.toFixed(0)}ms`);
    this.#write(
      'command',
      `${bold(name.padEnd(8))} ${paint('gray', 'dari')} ${sender} ${paint('gray', '@')} ${chat}  ${result} ${time}`,
    );
  }

  /** Menampilkan kode pairing dalam kotak yang mudah dibaca. */
  pairingCode({ phone, code, custom }) {
    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
    const content = [
      `KODE PAIRING${custom ? ' (kustom)' : ''}`,
      '',
      `    ${formatted}`,
    ];
    const width = Math.max(...content.map((line) => line.length)) + 6;
    const row = (text) => `  │ ${text.padEnd(width - 2)} │`;
    const box = [
      `  ┌${'─'.repeat(width)}┐`,
      ...content.map(row),
      `  └${'─'.repeat(width)}┘`,
    ];

    console.log('');
    console.log(paint('yellow', box.join('\n')));
    console.log('');
    this.info(`Buka WhatsApp di +${phone} › Perangkat tertaut › Tautkan perangkat`);
    this.info('Pilih "Tautkan dengan nomor telepon saja", lalu masukkan kode di atas.');
    this.warn('Kode berlaku singkat, masukkan segera. Jika gagal, tekan Ctrl+C lalu jalankan ulang untuk kode baru.');
  }

  static banner({ name, prefixes, node }) {
    const p = prefixes[0];
    const lines = [
      '',
      '  ╔═══════════════════════════════════════╗',
      '  ║       TWEBot Lite - Projects          ║',
      '  ║          powered by Baileys           ║',
      '  ╚═══════════════════════════════════════╝',
    ];
    console.log(paint('cyan', lines.join('\n')));
    console.log(`  ${paint('gray', 'Nama    ')} ${bold(name)}`);
    console.log(`  ${paint('gray', 'Prefix  ')} ${bold(prefixes.join('  '))}`);
    console.log(`  ${paint('gray', 'Runtime ')} Node ${node}`);
    console.log('');
  }

  #write(level, message) {
    const { label, color, icon } = LEVELS[level];
    const time = paint('gray', new Date().toTimeString().slice(0, 8));
    const tag = paint(color, `${icon} ${label}`);
    const scope = paint('blue', `[${this.#scope}]`);
    const stream = level === 'error' ? console.error : console.log;
    stream(`${time} ${tag} ${scope} ${message}`);
    this.#enqueue('runtime-logs.txt', this.#record(LEVELS[level].label.trim(), message));
  }

  #record(level, message) {
    return `[${new Date().toISOString()}] [${level}] [${this.#scope}] ${String(message)}`;
  }

  /**
   * Buffer per-proses (Map berbagi referensi antar instance Logger) dengan flush
   * ter-batch setiap FLUSH_INTERVAL_MS — menggantikan appendFileSync per baris
   * yang memblokir event loop di hot path.
   */
  #enqueue(file, text) {
    const sanitized = Logger.sanitize(text);
    const bucket = Logger.#buffers.get(file) ?? [];
    bucket.push(sanitized);
    Logger.#buffers.set(file, bucket);
    if (!Logger.#flushTimer) {
      Logger.#flushTimer = setTimeout(() => Logger.#flushAll(), FLUSH_INTERVAL_MS);
      Logger.#flushTimer.unref?.();
    }
  }

  static #flushAll() {
    Logger.#flushTimer = null;
    for (const [file, bucket] of Logger.#buffers) {
      if (bucket.length === 0) continue;
      const batch = bucket.join('\n') + '\n';
      bucket.length = 0;
      Logger.#flushQueue = Logger.#flushQueue
        .then(() => Logger.#appendRotating(file, batch))
        .catch((error) => console.error(`Gagal menulis ${file}: ${error.message}`));
    }
  }

  /** Tulis batch dengan rotasi sederhana: runtime-logs.txt -> runtime-logs.txt.1 saat > LOG_MAX_BYTES. */
  static async #appendRotating(file, batch) {
    const target = path.resolve(file);
    try {
      const stat = await fs.promises.stat(target).catch(() => null);
      if (stat && stat.size + Buffer.byteLength(batch) > LOG_MAX_BYTES) {
        await fs.promises.rm(`${target}.1`, { force: true });
        await fs.promises.rename(target, `${target}.1`).catch(() => {});
      }
      await fs.promises.appendFile(target, batch, 'utf8');
    } catch (error) {
      console.error(`Gagal menulis ${file}: ${error.message}`);
    }
  }

  /** Flush paksa (mis. sebelum exit) — dipanggil via Logger.shutdown(). */
  static shutdown() {
    if (Logger.#flushTimer) {
      clearTimeout(Logger.#flushTimer);
      Logger.#flushTimer = null;
    }
    Logger.#flushAll();
    return Logger.#flushQueue;
  }

  /**
   * Redaksi nomor telepon (≥9 digit berturut, dengan atau tanpa +) menjadi 62***1234
   * agar log tidak menyimpan PII pihak ketiga secara utuh.
   */
  static sanitize(text) {
    return String(text ?? '').replace(/\+?\d{9,}/g, (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 9) return match;
      return `${digits.slice(0, 2)}***${digits.slice(-4)}`;
    });
  }

  #formatError(error, depth = 0) {
    if (depth > 6) return '[cause chain truncated]';
    if (!(error instanceof Error)) return `Thrown value: ${this.#safeString(error)}`;
    const details = [`${error.name}: ${error.message}`];
    if (error.stack) details.push(error.stack);
    for (const key of Object.keys(error)) {
      if (key === 'cause') continue;
      details.push(`${key}: ${this.#safeString(error[key])}`);
    }
    if (error.cause) details.push(`Caused by:\n${this.#formatError(error.cause, depth + 1)}`);
    return details.join('\n');
  }

  #safeString(value) {
    try { return typeof value === 'string' ? value : JSON.stringify(value); }
    catch { return String(value); }
  }
}
