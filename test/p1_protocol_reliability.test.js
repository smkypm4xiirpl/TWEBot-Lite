import test from 'node:test';
import assert from 'node:assert/strict';
import { isQuotedFromMe } from '../src/core/MessageExtractor.js';
import { JsonStore } from '../src/services/JsonStore.js';
import { SystemInfoService } from '../src/services/SystemInfoService.js';
import { ProviderInfoService } from '../src/services/ProviderInfoService.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('P1: isQuotedFromMe accurately detects bot messages in 1:1 and groups', () => {
  const botUser = { id: '628123456789:1@s.whatsapp.net', lid: '111222333@lid' };

  // Group: participant is bot phone JID -> true
  assert.equal(
    isQuotedFromMe({ participant: '628123456789@s.whatsapp.net' }, true, false, botUser),
    true,
  );

  // Group: participant is bot LID -> true
  assert.equal(
    isQuotedFromMe({ participant: '111222333@lid' }, true, false, botUser),
    true,
  );

  // Group: participant is someone else -> false
  assert.equal(
    isQuotedFromMe({ participant: '628999999999@s.whatsapp.net' }, true, false, botUser),
    false,
  );

  // 1:1 chat: participant is absent, incoming message is from user (!incomingFromMe) -> true (replied to bot)
  assert.equal(
    isQuotedFromMe({}, false, false, botUser),
    true,
  );

  // 1:1 chat: participant is absent, incoming message is from bot (incomingFromMe) -> false (replied to user)
  assert.equal(
    isQuotedFromMe({}, false, true, botUser),
    false,
  );
});

test('P1: JsonStore handles save, load, and corruption safely', async () => {
  const tmpFile = path.join(os.tmpdir(), `test-store-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const store = new JsonStore(tmpFile);

  // Fallback on missing file
  const fallback = { count: 0 };
  assert.deepEqual(await store.load(fallback), fallback);

  // Save and load
  await store.save({ count: 42 });
  assert.deepEqual(await store.load(fallback), { count: 42 });

  // Corrupt file -> backs up and returns fallback
  await fs.writeFile(tmpFile, '{ corrupted json');
  assert.deepEqual(await store.load(fallback), fallback);

  // Cleanup
  await fs.unlink(tmpFile).catch(() => {});
});

test('P1: SystemInfoService snapshot is instantaneous (no sleep) and ProviderInfoService prewarms', async () => {
  const sys = new SystemInfoService({ cpuSampleMs: 0 });
  const start = performance.now();
  const info = await sys.snapshot();
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 400, `snapshot took ${elapsed}ms, should be <400ms (no 500ms sleep)`);
  assert.ok(info.hostname);
  assert.ok(info.memory);
  sys.stop();

  let fetched = false;
  const mockFetch = async () => {
    fetched = true;
    return {
      ok: true,
      json: async () => ({ ip: '1.2.3.4', city: 'Jakarta', country_code: 'ID' }),
    };
  };

  const provider = new ProviderInfoService({
    cacheMs: 60000,
    timeoutMs: 1000,
    fetchImpl: mockFetch,
  });

  await provider.prewarm();
  assert.equal(fetched, true);

  const res = await provider.lookup();
  assert.equal(res?.ip, '1.2.3.4');
});

test('P1: ProviderInfoService deduplicates concurrent inflight lookups', async () => {
  let networkCalls = 0;
  const mockFetch = async () => {
    networkCalls++;
    await new Promise((r) => setTimeout(r, 20));
    return {
      ok: true,
      json: async () => ({ ip: '5.6.7.8', city: 'Bandung', country_code: 'ID' }),
    };
  };

  const provider = new ProviderInfoService({
    cacheMs: 60000,
    timeoutMs: 1000,
    fetchImpl: mockFetch,
  });

  // Call lookup concurrently 5 times before any completes
  const results = await Promise.all([
    provider.lookup(),
    provider.lookup(),
    provider.lookup(),
    provider.lookup(),
    provider.lookup(),
  ]);

  // Network call should only be executed ONCE
  assert.equal(networkCalls, 1);
  for (const res of results) {
    assert.equal(res?.ip, '5.6.7.8');
  }
});

test('P1: hasViewOnceWrapper accurately parses multi-key and nested wrappers', async () => {
  const { hasViewOnceWrapper } = await import('../src/core/MessageExtractor.js');

  // Case 1: Simple view-once wrapper
  assert.equal(hasViewOnceWrapper({ viewOnceMessage: { message: {} } }), true);
  assert.equal(hasViewOnceWrapper({ viewOnceMessageV2: { message: {} } }), true);

  // Case 2: Multi-key object where a non-viewOnce wrapper comes first, but viewOnce is nested or secondary
  const multiKey = {
    ephemeralMessage: {
      message: {
        viewOnceMessageV2: {
          message: { imageMessage: {} },
        },
      },
    },
  };
  assert.equal(hasViewOnceWrapper(multiKey), true);

  // Case 3: Ephemeral without viewOnce
  const normalEphemeral = {
    ephemeralMessage: {
      message: {
        conversation: 'plain text',
      },
    },
  };
  assert.equal(hasViewOnceWrapper(normalEphemeral), false);

  // Case 4: Null / empty / non-object
  assert.equal(hasViewOnceWrapper(null), false);
  assert.equal(hasViewOnceWrapper({}), false);
});
