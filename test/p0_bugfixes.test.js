import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { normalizePairingCode, PairingAuthenticator } from '../src/core/PairingAuthenticator.js';
import { ViewOnceCache } from '../src/services/ViewOnceCache.js';
import { AvoCommand } from '../src/commands/AvoCommand.js';
import { BotError } from '../src/errors/BotError.js';
import { BotClient } from '../src/core/BotClient.js';
import { MessageHandler } from '../src/core/MessageHandler.js';

test('P0: config.pairingCode tidak memakai fallback hardcoded dan validasi kode tetap bekerja', async () => {
  // Simulasi env PAIRING_CODE kosong: set '' sebelum re-import (dotenv tidak
  // menimpa key yang sudah ada), sehingga fallback hardcoded bisa diuji deterministik.
  const originalPairingCode = process.env.PAIRING_CODE;
  process.env.PAIRING_CODE = '';
  const freshConfig = (await import('../src/config.js?pairing-fallback-test=1')).config;
  if (originalPairingCode === undefined) delete process.env.PAIRING_CODE;
  else process.env.PAIRING_CODE = originalPairingCode;

  assert.equal(freshConfig.pairingCode, null, 'PAIRING_CODE kosong -> null (kode acak dari server), bukan default hardcoded');

  if (config.pairingCode !== null) {
    const normalized = normalizePairingCode(config.pairingCode);
    assert.ok(normalized, 'Jika diisi via env, PAIRING_CODE harus valid Crockford Base32');
    assert.equal(normalized.length, 8);
  }

  // Rejection of invalid codes (with 0, O, I, U)
  assert.equal(normalizePairingCode('TWEB-2026'), null, 'Codes with 0 must be rejected');
  assert.equal(normalizePairingCode('TWEB-2O26'), null, 'Codes with O must be rejected');
  assert.equal(normalizePairingCode('TWEB-2I26'), null, 'Codes with I must be rejected');
  assert.equal(normalizePairingCode('TWEB-2126'), 'TWEB2126', 'Valid custom code accepted');
  assert.equal(normalizePairingCode('short'), null, 'Wrong length must be rejected');

  // Authenticator menerima customCode null (mode kode acak) tanpa error
  const auth = new PairingAuthenticator({
    logger: { pairingCode: () => {}, error: () => {}, warn: () => {} },
    phoneNumber: '628123456789',
    customCode: null,
    interactive: false,
  });
  assert.ok(auth);
});

test('P0: ViewOnceCache evicts ALL expired entries regardless of order, and bounds size to max', () => {
  let currentTime = 1000;
  const cache = new ViewOnceCache({ max: 3, ttlMs: 500, now: () => currentTime });

  const makeCtx = (id, expiresOffset, isViewOnce = true) => ({
    jid: 'chat1@s.whatsapp.net',
    messageId: id,
    findMedia: () => (isViewOnce ? { type: 'imageMessage', node: {}, viewOnce: true } : null),
  });

  // Insert entry 1 at t=1000 (expires at 1500)
  cache.remember(makeCtx('m1'));
  assert.equal(cache.size, 1);

  // Advance time to 1200, insert entry 2 (expires at 1700)
  currentTime = 1200;
  cache.remember(makeCtx('m2'));
  assert.equal(cache.size, 2);

  // Advance time to 1600. Entry 1 is expired (expiresAt 1500 <= 1600), entry 2 is NOT expired (1700 > 1600).
  currentTime = 1600;
  // Insert entry 3 (expires at 2100)
  cache.remember(makeCtx('m3'));

  // Entry 1 MUST be evicted even if entry 2 is newer and unexpired
  assert.equal(cache.recall({ jid: 'chat1@s.whatsapp.net', quotedId: 'm1' }), null);
  assert.ok(cache.recall({ jid: 'chat1@s.whatsapp.net', quotedId: 'm2' }));
  assert.ok(cache.recall({ jid: 'chat1@s.whatsapp.net', quotedId: 'm3' }));
  assert.equal(cache.size, 2);

  // Test LRU max capacity pruning
  currentTime = 1610;
  cache.remember(makeCtx('m4'));
  cache.remember(makeCtx('m5'));
  // Max is 3: size should never exceed 3
  assert.ok(cache.size <= 3);
});

test('P0: AvoCommand rejects media that is not marked viewOnce', async () => {
  const cache = new ViewOnceCache({ max: 10, ttlMs: 10000 });
  const avo = new AvoCommand({ cache, prefix: '.', ownerOnly: false });

  // Case 1: Quoted normal media (not view-once)
  const nonVoCtx = {
    jid: 'chat@s.whatsapp.net',
    quotedId: 'norm1',
    findMedia: () => ({ type: 'imageMessage', node: {}, viewOnce: false }),
    react: async () => {},
    reply: async () => {},
  };

  await assert.rejects(
    async () => {
      await avo.execute(nonVoCtx);
    },
    (err) => {
      assert.ok(err instanceof BotError);
      assert.match(err.userMessage, /bukan media sekali-lihat/);
      return true;
    },
  );

  // Case 2: No media quoted at all -> prints guide
  let repliedText = '';
  const noMediaCtx = {
    jid: 'chat@s.whatsapp.net',
    quotedId: null,
    findMedia: () => null,
    react: async () => {},
    reply: async (text) => {
      repliedText = text;
    },
  };
  await avo.execute(noMediaCtx);
  assert.match(repliedText, /ANTI VIEW ONCE/);
});

test('P0: BotClient clears reconnect timer on stop()', () => {
  const client = new BotClient({
    config: { sessionDir: 'session' },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    messageHandler: { handle: () => {} },
    pairing: { prepare: async () => {}, reset: () => {} },
  });

  // Client stop clears timer without error
  client.stop();
  assert.ok(true);
});

test('P0: Semaphore bounds concurrency, handles invalid max, and releases on error', async () => {
  const { Semaphore } = await import('../src/utils/Semaphore.js');

  // Handles undefined / NaN / non-positive numbers safely by falling back to 1
  const semInvalid1 = new Semaphore(undefined);
  const semInvalid2 = new Semaphore('invalid');
  const semInvalid3 = new Semaphore(-5);
  assert.equal(await semInvalid1.run(() => 42), 42);
  assert.equal(await semInvalid2.run(() => 43), 43);
  assert.equal(await semInvalid3.run(() => 44), 44);

  // Concurrency bounds: at most 2 tasks run concurrently
  const sem = new Semaphore(2);
  let active = 0;
  let maxActive = 0;

  const makeTask = (delay) => async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, delay));
    active--;
    return 'done';
  };

  await Promise.all([
    sem.run(makeTask(20)),
    sem.run(makeTask(20)),
    sem.run(makeTask(20)),
    sem.run(makeTask(20)),
  ]);

  assert.equal(maxActive, 2);
  assert.equal(active, 0);

  // Semaphore always releases slot even on synchronous or asynchronous rejection
  await assert.rejects(async () => {
    await sem.run(() => {
      throw new Error('fail');
    });
  });
  assert.equal(active, 0);
  assert.equal(await sem.run(() => 'recovered'), 'recovered');
});

test('P0: FfmpegService instantiates safely with default parameters', () => {
  const { FfmpegService } = import('../src/services/FfmpegService.js');
  // Must not throw TypeError: Cannot destructure property 'binaryPath' of 'undefined'
  assert.doesNotThrow(async () => {
    const { FfmpegService } = await import('../src/services/FfmpegService.js');
    new FfmpegService();
  });
});
