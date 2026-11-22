import test from 'node:test';
import assert from 'node:assert/strict';
import { GroupSettings } from '../src/services/GroupSettings.js';
import { MessageHandler } from '../src/core/MessageHandler.js';

test('GroupSettings: syncGroups prunes stale groups and stale overrides while preserving active', async () => {
  let savedData = null;
  const fakeStore = {
    load: async () => ({
      policyVersion: 2,
      defaultEnabled: false,
      overrides: {
        'old1@g.us': true,
        'keep1@g.us': true,
      },
      knownGroups: {
        'old1@g.us': 'Old Group 1',
        'old2@g.us': 'Old Group 2',
        'keep1@g.us': 'Keep Group 1 Old Name',
      },
      privateOnly: false,
    }),
    save: async (data) => {
      savedData = data;
    },
  };

  const groupSettings = new GroupSettings({ store: fakeStore, defaultEnabled: false });
  await groupSettings.init();

  assert.equal(groupSettings.groups().length, 3);
  assert.equal(groupSettings.isEnabled('old1@g.us'), true);
  assert.equal(groupSettings.isEnabled('keep1@g.us'), true);

  // Bot changes number or syncs active participating groups
  const activeGroups = [
    ['keep1@g.us', 'Keep Group 1 New Name'],
    ['new1@g.us', 'Brand New Group'],
  ];

  await groupSettings.syncGroups(activeGroups);

  const current = groupSettings.groups();
  assert.equal(current.length, 2);
  assert.deepEqual(current, [
    ['keep1@g.us', 'Keep Group 1 New Name'],
    ['new1@g.us', 'Brand New Group'],
  ]);

  // Stale override for old1@g.us must be pruned, active override for keep1@g.us retained
  assert.equal(groupSettings.hasOverride('old1@g.us'), false);
  assert.equal(groupSettings.hasOverride('keep1@g.us'), true);
  assert.equal(groupSettings.isEnabled('keep1@g.us'), true);

  // Saved data reflects pruned state (format tunggal: blok accounts)
  assert.ok(savedData);
  const savedAcc = savedData.accounts[savedData.currentAccount];
  assert.deepEqual(savedAcc.knownGroups, {
    'keep1@g.us': 'Keep Group 1 New Name',
    'new1@g.us': 'Brand New Group',
  });
  assert.deepEqual(savedAcc.overrides, {
    'keep1@g.us': true,
  });
});

test('GroupSettings: phone number change prunes old number groups (no 49 + 128 = 177 accumulation)', async () => {
  let savedData = null;
  const initialKnown = {};
  for (let i = 1; i <= 49; i++) {
    initialKnown[`old_group_${i}@g.us`] = `Old Group ${i}`;
  }

  const fakeStore = {
    load: async () => ({
      policyVersion: 2,
      defaultEnabled: false,
      overrides: { 'old_group_1@g.us': true },
      knownGroups: initialKnown,
      privateOnly: false,
    }),
    save: async (data) => {
      savedData = data;
    },
  };

  const groupSettings = new GroupSettings({ store: fakeStore, defaultEnabled: false });
  await groupSettings.init();
  assert.equal(groupSettings.groups().length, 49);

  // New phone number has 128 groups
  const newNumberGroups = [];
  for (let i = 1; i <= 128; i++) {
    newNumberGroups.push([`new_group_${i}@g.us`, `New Group ${i}`]);
  }

  await groupSettings.syncGroups(newNumberGroups);

  // Must be 128, NOT 177
  assert.equal(groupSettings.groups().length, 128);
  assert.equal(groupSettings.hasOverride('old_group_1@g.us'), false);
  assert.equal(Object.keys(savedData.accounts[savedData.currentAccount].knownGroups).length, 128);
});

test('GroupSettings: rememberGroup keeps existing groups and appends single group', async () => {
  let savedData = null;
  const fakeStore = {
    load: async () => ({
      policyVersion: 2,
      defaultEnabled: false,
      overrides: {},
      knownGroups: {
        'existing@g.us': 'Existing Group',
      },
      privateOnly: false,
    }),
    save: async (data) => {
      savedData = data;
    },
  };

  const groupSettings = new GroupSettings({ store: fakeStore, defaultEnabled: false });
  await groupSettings.init();

  await groupSettings.rememberGroup('single_new@g.us', 'Single New Group');

  assert.equal(groupSettings.groups().length, 2);
  assert.deepEqual(groupSettings.groups(), [
    ['existing@g.us', 'Existing Group'],
    ['single_new@g.us', 'Single New Group'],
  ]);
  assert.equal(savedData.accounts[savedData.currentAccount].knownGroups['existing@g.us'], 'Existing Group');
  assert.equal(savedData.accounts[savedData.currentAccount].knownGroups['single_new@g.us'], 'Single New Group');
});

test('MessageHandler: syncGroups and rememberGroups sync participating groups from sock', async () => {
  let syncedEntries = null;
  const fakeGroupSettings = {
    syncGroups: async (entries) => {
      syncedEntries = entries;
    },
  };

  const loggedInfo = [];
  const fakeLogger = {
    info: (msg) => loggedInfo.push(msg),
    error: () => {},
    warn: () => {},
    debug: () => {},
  };

  const handler = new MessageHandler({
    registry: { resolve: () => null },
    parser: { parse: () => null },
    logger: fakeLogger,
    config: { messageConcurrency: 2 },
    groups: fakeGroupSettings,
    owners: { isOwner: () => false },
    viewOnceCache: {},
  });

  const fakeSock = {
    groupFetchAllParticipating: async () => ({
      'group1@g.us': { subject: 'Grup Satu' },
      'group2@g.us': { subject: 'Grup Dua' },
    }),
  };

  await handler.syncGroups(fakeSock);

  assert.deepEqual(syncedEntries, [
    ['group1@g.us', 'Grup Satu'],
    ['group2@g.us', 'Grup Dua'],
  ]);
  assert.ok(loggedInfo.some((msg) => msg.includes('2 grup')));

  // rememberGroups also delegates to syncGroups
  syncedEntries = null;
  await handler.rememberGroups(fakeSock);
  assert.deepEqual(syncedEntries, [
    ['group1@g.us', 'Grup Satu'],
    ['group2@g.us', 'Grup Dua'],
  ]);
});

test('GroupSettings: multi-account isolates groups and settings per phone number', async () => {
  let savedData = null;
  const fakeStore = {
    load: async () => null,
    save: async (data) => {
      savedData = data;
    },
  };

  const groupSettings = new GroupSettings({ store: fakeStore, defaultEnabled: false });
  await groupSettings.init();

  // 1. Bot runs with Number 1
  await groupSettings.bindAccount('628111111');
  assert.equal(groupSettings.currentAccountId, '628111111');

  // Sync 3 groups for Number 1 and set override
  await groupSettings.syncGroups([
    ['num1_g1@g.us', 'Number 1 Group 1'],
    ['num1_g2@g.us', 'Number 1 Group 2'],
    ['num1_g3@g.us', 'Number 1 Group 3'],
  ]);
  await groupSettings.setEnabled('num1_g1@g.us', true);

  assert.equal(groupSettings.groups().length, 3);
  assert.equal(groupSettings.isEnabled('num1_g1@g.us'), true);
  assert.equal(groupSettings.isEnabled('num1_g2@g.us'), false);

  // 2. Bot runs with Number 2
  await groupSettings.bindAccount('628222222');
  assert.equal(groupSettings.currentAccountId, '628222222');

  // Number 2 has 2 different groups and different settings
  assert.equal(groupSettings.groups().length, 0); // Fresh for number 2
  await groupSettings.syncGroups([
    ['num2_gA@g.us', 'Number 2 Group A'],
    ['num2_gB@g.us', 'Number 2 Group B'],
  ]);
  await groupSettings.setEnabled('num2_gB@g.us', true);

  assert.equal(groupSettings.groups().length, 2);
  assert.equal(groupSettings.isEnabled('num2_gA@g.us'), false);
  assert.equal(groupSettings.isEnabled('num2_gB@g.us'), true);

  // 3. Bot switches back to Number 1
  await groupSettings.bindAccount('628111111');
  assert.equal(groupSettings.currentAccountId, '628111111');

  // All 3 groups and override for Number 1 are preserved intact!
  assert.equal(groupSettings.groups().length, 3);
  assert.deepEqual(groupSettings.groups().map(([jid]) => jid), [
    'num1_g1@g.us',
    'num1_g2@g.us',
    'num1_g3@g.us',
  ]);
  assert.equal(groupSettings.isEnabled('num1_g1@g.us'), true);
  assert.equal(groupSettings.isEnabled('num1_g2@g.us'), false);

  // Both accounts exist in persisted JSON data
  assert.ok(savedData.accounts['628111111']);
  assert.ok(savedData.accounts['628222222']);
  assert.equal(Object.keys(savedData.accounts['628111111'].knownGroups).length, 3);
  assert.equal(Object.keys(savedData.accounts['628222222'].knownGroups).length, 2);
});

test('GroupSettings: zero groups ({}) cleanly clears #knownGroups and stale overrides', async () => {
  let savedData = null;
  const fakeStore = {
    load: async () => ({
      policyVersion: 2,
      defaultEnabled: false,
      overrides: { 'stale@g.us': true },
      knownGroups: { 'stale@g.us': 'Stale Group' },
      privateOnly: false,
    }),
    save: async (data) => {
      savedData = data;
    },
  };

  const groupSettings = new GroupSettings({ store: fakeStore, defaultEnabled: false });
  await groupSettings.init();
  assert.equal(groupSettings.groups().length, 1);
  assert.equal(groupSettings.hasOverride('stale@g.us'), true);

  // Sync zero groups
  await groupSettings.syncGroups({});
  assert.equal(groupSettings.groups().length, 0);
  assert.equal(groupSettings.hasOverride('stale@g.us'), false);
  assert.deepEqual(savedData.accounts[savedData.currentAccount].knownGroups, {});
  assert.deepEqual(savedData.accounts[savedData.currentAccount].overrides, {});
});

test('GroupSettings: does not destructure string elements or degrade existing group names', async () => {
  let savedData = null;
  const fakeStore = {
    load: async () => null,
    save: async (data) => {
      savedData = data;
    },
  };

  const groupSettings = new GroupSettings({ store: fakeStore, defaultEnabled: false });
  await groupSettings.init();

  // Passing array of string JIDs
  await groupSettings.syncGroups(['12036301@g.us', '12036302@g.us']);
  assert.equal(groupSettings.groups().length, 2);
  assert.deepEqual(groupSettings.groups(), [
    ['12036301@g.us', '12036301@g.us'],
    ['12036302@g.us', '12036302@g.us'],
  ]);
  assert.equal(groupSettings.hasGroup('12036301@g.us'), true);
  assert.equal(groupSettings.hasGroup('unknown@g.us'), false);
  assert.equal(groupSettings.getGroupName('12036301@g.us'), '12036301@g.us');

  // Updating name
  await groupSettings.rememberGroup('12036301@g.us', 'Special Group');
  assert.equal(groupSettings.getGroupName('12036301@g.us'), 'Special Group');

  // Calling rememberGroup with default jid must NOT degrade 'Special Group' back to raw JID
  await groupSettings.rememberGroup('12036301@g.us');
  assert.equal(groupSettings.getGroupName('12036301@g.us'), 'Special Group');
});

test('MessageHandler: handles diverse group metadata formats and socket error paths safely', async () => {
  let synced = null;
  const fakeGroups = {
    syncGroups: async (entries) => {
      synced = entries;
    },
    bindAccount: async () => {},
  };

  const loggedWarnings = [];
  const loggedErrors = [];
  const fakeLogger = {
    info: () => {},
    warn: (msg) => loggedWarnings.push(msg),
    error: (msg, err) => loggedErrors.push({ msg, err }),
    debug: () => {},
  };

  const handler = new MessageHandler({
    registry: { resolve: () => null },
    parser: { parse: () => null },
    logger: fakeLogger,
    config: { messageConcurrency: 2 },
    groups: fakeGroups,
    owners: { isOwner: () => false },
    viewOnceCache: {},
  });

  // 1. Array of metadata objects and map of strings
  const fakeSockArray = {
    user: { id: '6289999999:1@s.whatsapp.net' },
    groupFetchAllParticipating: async () => [
      { id: 'arr1@g.us', subject: 'Array Group 1' },
      ['arr2@g.us', 'Array Group 2'],
    ],
  };
  await handler.syncGroups(fakeSockArray);
  assert.deepEqual(synced, [
    ['arr1@g.us', 'Array Group 1'],
    ['arr2@g.us', 'Array Group 2'],
  ]);

  // 2. Map of strings
  const fakeSockStringMap = {
    groupFetchAllParticipating: async () => ({
      'map1@g.us': 'Map Group 1',
    }),
  };
  await handler.syncGroups(fakeSockStringMap);
  assert.deepEqual(synced, [
    ['map1@g.us', 'Map Group 1'],
  ]);

  // 3. Socket returns null / undefined -> does not wipe groups
  synced = 'not-called';
  const fakeSockNull = {
    groupFetchAllParticipating: async () => null,
  };
  await handler.syncGroups(fakeSockNull);
  assert.equal(synced, 'not-called');
  assert.ok(loggedWarnings.length > 0);

  // 4. Invalid socket -> warns and does not crash
  await handler.syncGroups(null);
  assert.equal(synced, 'not-called');

  // 5. Socket throws error -> logs error safely
  const fakeSockThrow = {
    groupFetchAllParticipating: async () => {
      throw new Error('Network timeout');
    },
  };
  await handler.syncGroups(fakeSockThrow);
  assert.ok(loggedErrors.some((e) => e.msg.includes('Gagal menyinkronkan')));
});
