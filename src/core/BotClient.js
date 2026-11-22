import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { baileysLogger } from './baileysLogger.js';

const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_STORED_MESSAGES = 500;

// Pairing via nomor telepon wajib memakai klien bertipe browser (Chrome).
// Browsers.*('Desktop') dipetakan sebagai aplikasi Electron/UWP sehingga HP menolak
// kodenya dengan pesan "Couldn't link device".
const COMPANION_BROWSER = Browsers.ubuntu('Chrome');

/** Mengelola siklus hidup koneksi WhatsApp: login (pairing code), reconnect, dan shutdown. */
export class BotClient {
  #config;
  #logger;
  #messageHandler;
  #pairing;
  #sock = null;
  #retries = 0;
  #stopping = false;
  #reconnectTimer = null;
  #messageStore = new Map();
  #cachedVersion = null;

  constructor({ config, logger, messageHandler, pairing }) {
    this.#config = config;
    this.#logger = logger;
    this.#messageHandler = messageHandler;
    this.#pairing = pairing;
  }

  async start() {
    const { state, saveCreds } = await useMultiFileAuthState(this.#config.sessionDir);

    if (!state.creds.registered) {
      await this.#pairing.prepare(); // tanya nomor & kode kustom SEBELUM socket dibuat
      this.#pairing.reset();
    }

    const sock = makeWASocket({
      version: await this.#resolveVersion(),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      logger: baileysLogger,
      browser: COMPANION_BROWSER,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      shouldIgnoreJid: (jid) => jid?.endsWith('@broadcast') || jid?.endsWith('@newsletter'),
      getMessage: async (key) => {
        if (!key?.id) return undefined;
        const fullId = key.remoteJid ? `${key.remoteJid}:${key.id}` : null;
        return (fullId && this.#messageStore.get(fullId)) || this.#messageStore.get(key.id);
      },
    });

    if (this.#stopping) {
      sock.end(undefined);
      return;
    }

    this.#sock = sock;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => this.#onConnectionUpdate(sock, update));
    sock.ev.on('messages.upsert', (upsert) => {
      this.#logger?.debug(
        `BotClient: menerima messages.upsert (tipe=${upsert?.type}, count=${upsert?.messages?.length ?? 0})`,
      );
      this.#rememberMessages(upsert);
      this.#messageHandler.handle(sock, upsert);
    });
  }

  stop() {
    this.#stopping = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#sock?.end(undefined);
  }

  #rememberMessages(upsert) {
    for (const msg of upsert.messages ?? []) {
      if (msg.key?.id && msg.message) {
        if (msg.key.remoteJid) {
          this.#messageStore.set(`${msg.key.remoteJid}:${msg.key.id}`, msg.message);
        }
        this.#messageStore.set(msg.key.id, msg.message);
        while (this.#messageStore.size > MAX_STORED_MESSAGES * 2) {
          const oldestKey = this.#messageStore.keys().next().value;
          this.#messageStore.delete(oldestKey);
        }
      }
    }
  }

  #resolveVersion() {
    // Cache versi antar reconnect: hindari network call berulang saat koneksi flaky.
    if (this.#cachedVersion) return Promise.resolve(this.#cachedVersion);
    return fetchLatestBaileysVersion()
      .then(({ version }) => {
        this.#cachedVersion = version;
        this.#logger.info(`Menggunakan WhatsApp Web v${version.join('.')}`);
        return version;
      })
      .catch(() => {
        this.#logger.warn('Gagal mengambil versi WA terbaru, memakai default Baileys.');
        return undefined;
      });
  }

  async #onConnectionUpdate(sock, { connection, lastDisconnect, qr }) {
    this.#logger?.debug(
      `BotClient: connection.update status=${connection ?? 'n/a'}, qr=${Boolean(qr)}, registered=${Boolean(sock?.authState?.creds?.registered)}`,
    );
    // Event `qr` hanya dipakai sebagai sinyal socket siap untuk pairing; QR tidak ditampilkan.
    if (qr && !sock.authState.creds.registered) {
      await this.#pairing.request(sock);
    }

    if (connection === 'connecting') {
      this.#logger.info('Menghubungkan ke WhatsApp...');
    } else if (connection === 'open') {
      this.#retries = 0;
      const id = sock.user?.id?.split(':')[0] ?? 'unknown';
      this.#logger.success(`Terhubung sebagai ${sock.user?.name ?? 'bot'} (${id}). Siap menerima command!`);
      this.#messageHandler.rememberGroups(sock).catch((error) => this.#logger.error('Sinkronisasi daftar grup gagal', error));
    } else if (connection === 'close') {
      this.#onClose(sock, lastDisconnect?.error);
    }
  }

  #onClose(sock, error) {
    sock.ev.removeAllListeners('connection.update');
    sock.ev.removeAllListeners('messages.upsert');
    sock.ev.removeAllListeners('creds.update');

    if (this.#stopping) {
      this.#logger.info('Koneksi ditutup.');
      return;
    }

    const statusCode = error?.output?.statusCode;
    if (statusCode === DisconnectReason.loggedOut) {
      this.#logger.error(`Sesi logout. Hapus folder "${this.#config.sessionDir}" lalu jalankan ulang untuk login.`);
      process.exit(1);
    }

    const delay = Math.min(1000 * 2 ** this.#retries, MAX_RECONNECT_DELAY_MS);
    this.#retries += 1;
    this.#logger.warn(`Koneksi terputus (kode ${statusCode ?? '?'}). Reconnect dalam ${delay / 1000}s...`);

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#stopping) return;
      this.start().catch((err) => this.#onClose(sock, err));
    }, delay);
  }
}
