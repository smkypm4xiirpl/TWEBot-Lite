import 'dotenv/config';
import path from 'node:path';

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toOwnerList = (value) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const toList = (value, fallback) => {
  const list = (value ?? fallback).split(',').map((item) => item.trim()).filter(Boolean);
  return list.length > 0 ? list : [fallback];
};

export const config = Object.freeze({
  botName: process.env.BOT_NAME || 'TWEBot-Lite',
  prefixes: Object.freeze(toList(process.env.PREFIXES, '.')),
  sessionDir: path.resolve(process.env.SESSION_DIR || 'session'),
  pairingNumber: process.env.PAIRING_NUMBER || null,
  pairingCode: process.env.PAIRING_CODE || null,
  ffmpegPath: process.env.FFMPEG_PATH || null,
  ffmpegConcurrency: toInt(process.env.FFMPEG_CONCURRENCY, 2),
  messageConcurrency: toInt(process.env.MESSAGE_CONCURRENCY, 5),
  maxInputBytes: toInt(process.env.MAX_INPUT_MB, 25) * 1024 * 1024,
  staleMessageSeconds: 120,

  /** Nomor HP atau ID LID owner (format nomor HP atau JID). Akun bot sendiri selalu dianggap owner. */
  owners: Object.freeze(toOwnerList(process.env.OWNER_NUMBERS)),
  dataDir: path.resolve(process.env.DATA_DIR || 'data'),
  groupDefaultEnabled: (process.env.GROUP_DEFAULT ?? 'off').toLowerCase() !== 'off',
  avoOwnerOnly: (process.env.AVO_OWNER_ONLY ?? 'false').toLowerCase() === 'true',
  avoForwardGroup: process.env.AVO_FORWARD_GROUP || null,

  ping: Object.freeze({
    cpuSampleMs: 500,
    ipCacheMs: 10 * 60 * 1000,
    ipTimeoutMs: 4000,
  }),

  viewOnceCache: Object.freeze({
    max: 300,
    ttlMs: 6 * 60 * 60 * 1000,
  }),

  sticker: Object.freeze({
    size: 512,
    maxSeconds: 7,
    maxBytes: 900 * 1024,
    maxMetaLength: 32,
    defaultPack: process.env.DEFAULT_PACK || 'Sticker Bot',
    defaultAuthor: process.env.DEFAULT_AUTHOR || null,
    imageQuality: 80,
    /** Dicoba berurutan sampai ukuran hasil <= maxBytes. */
    videoEncodeSteps: Object.freeze([
      Object.freeze({ quality: 60, fps: 15 }),
      Object.freeze({ quality: 45, fps: 12 }),
      Object.freeze({ quality: 30, fps: 10 }),
      Object.freeze({ quality: 20, fps: 8 }),
    ]),
  }),

  video: Object.freeze({
    /** Warna latar saat sticker transparan dikonversi ke video. */
    background: '#ffffff',
  }),
});
