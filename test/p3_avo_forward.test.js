import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { ViewOnceForwarder } from '../src/services/ViewOnceForwarder.js';
import { AvoCommand } from '../src/commands/AvoCommand.js';
import { JsonStore } from '../src/services/JsonStore.js';
import { BotError } from '../src/errors/BotError.js';
import { MessageHandler } from '../src/core/MessageHandler.js';

test('P3: ViewOnceForwarder persistence and target configuration', async () => {
  const tmpFile = path.join(os.tmpdir(), `test-vof-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const store = new JsonStore(tmpFile);

  const forwarder = new ViewOnceForwarder({
    store,
    defaultTarget: '1203630default@g.us',
  });

  // Init with no file -> fallback to defaultTarget
  await forwarder.init();
  assert.equal(forwarder.targetJid, '1203630default@g.us');
  assert.equal(forwarder.isConfigured, true);

  // setTarget updates and persists
  await forwarder.setTarget('1203630target1@g.us');
  assert.equal(forwarder.targetJid, '1203630target1@g.us');

  // New instance loads persisted target
  const forwarder2 = new ViewOnceForwarder({ store });
  await forwarder2.init();
  assert.equal(forwarder2.targetJid, '1203630target1@g.us');

  // clearTarget removes target
  await forwarder2.clearTarget();
  assert.equal(forwarder2.targetJid, null);
  assert.equal(forwarder2.isConfigured, false);

  // New instance loads cleared state
  const forwarder3 = new ViewOnceForwarder({ store, defaultTarget: '1203630default@g.us' });
  await forwarder3.init();
  assert.equal(forwarder3.targetJid, null);

  // Instance without store uses defaultTarget directly
  const forwarderNoStore = new ViewOnceForwarder({ defaultTarget: '1203630inmemory@g.us' });
  assert.equal(forwarderNoStore.targetJid, '1203630inmemory@g.us');
  await forwarderNoStore.init();
  assert.equal(forwarderNoStore.targetJid, '1203630inmemory@g.us');

  await fs.unlink(tmpFile).catch(() => {});
});

test('P3: ViewOnceForwarder media forwarding and caption generation', async () => {
  const targetGroup = '1203630dest@g.us';
  const forwarder = new ViewOnceForwarder();
  await forwarder.setTarget(targetGroup);

  const sentMessages = [];
  const fakeSock = {
    sendMessage: async (jid, content, options) => {
      sentMessages.push({ jid, content, options });
      return { key: { id: `ack-${sentMessages.length}` } };
    },
  };

  // 1. Image View Once from a group
  const imageCtx = {
    jid: '1203630source@g.us',
    isGroup: true,
    fromMe: false,
    senderLabel: 'Budi (62811223344)',
    chatLabel: 'Grup',
    groupSubject: async () => 'Komunitas Koding',
    findMedia: () => ({
      type: 'imageMessage',
      node: { caption: 'Foto rahasia' },
      viewOnce: true,
    }),
    download: async () => Buffer.from('fake-image-bytes'),
  };

  const handledImage = await forwarder.handleMessage(imageCtx, fakeSock);
  assert.equal(handledImage, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].jid, targetGroup);
  assert.ok(sentMessages[0].content.image);
  assert.match(sentMessages[0].content.caption, /FORWARDED VIEW ONCE/);
  assert.match(sentMessages[0].content.caption, /Komunitas Koding/);
  assert.match(sentMessages[0].content.caption, /1203630source@g\.us/);
  assert.match(sentMessages[0].content.caption, /Budi \(62811223344\)/);
  assert.match(sentMessages[0].content.caption, /Foto rahasia/);

  // 2. Video View Once from 1:1 chat (private)
  sentMessages.length = 0;
  const videoCtx = {
    jid: '628987654321@s.whatsapp.net',
    isGroup: false,
    fromMe: false,
    senderLabel: 'Alice (628987654321)',
    chatLabel: 'Private',
    groupSubject: async () => null,
    findMedia: () => ({
      type: 'videoMessage',
      node: { mimetype: 'video/mp4' },
      viewOnce: true,
    }),
    download: async () => Buffer.from('fake-video-bytes'),
  };

  const handledVideo = await forwarder.handleMessage(videoCtx, fakeSock);
  assert.equal(handledVideo, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].jid, targetGroup);
  assert.ok(sentMessages[0].content.video);
  assert.equal(sentMessages[0].content.mimetype, 'video/mp4');
  assert.match(sentMessages[0].content.caption, /Pesan Pribadi \(Private Chat\)/);
  assert.match(sentMessages[0].content.caption, /Alice/);

  // 3. Audio / Voice Note View Once
  sentMessages.length = 0;
  const audioCtx = {
    jid: '1203630voice@g.us',
    isGroup: true,
    fromMe: false,
    senderLabel: 'Charlie (628555444333)',
    chatLabel: 'Grup',
    groupSubject: async () => 'Tim Support',
    findMedia: () => ({
      type: 'audioMessage',
      node: { ptt: true, mimetype: 'audio/ogg; codecs=opus' },
      viewOnce: true,
    }),
    download: async () => Buffer.from('fake-audio-bytes'),
  };

  const handledAudio = await forwarder.handleMessage(audioCtx, fakeSock);
  assert.equal(handledAudio, true);
  // Expect 2 calls: 1 for audio, 1 for quoted caption text
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].jid, targetGroup);
  assert.ok(sentMessages[0].content.audio);
  assert.equal(sentMessages[0].content.ptt, true);

  assert.equal(sentMessages[1].jid, targetGroup);
  assert.ok(sentMessages[1].content.text);
  assert.match(sentMessages[1].content.text, /FORWARDED VIEW ONCE/);
  assert.match(sentMessages[1].content.text, /Tim Support/);
  assert.equal(sentMessages[1].options?.quoted?.key?.id, 'ack-1');

  // 4. Ignores when fromMe: true
  sentMessages.length = 0;
  const fromMeCtx = { ...imageCtx, fromMe: true };
  const handledFromMe = await forwarder.handleMessage(fromMeCtx, fakeSock);
  assert.equal(handledFromMe, false);
  assert.equal(sentMessages.length, 0);

  // 5. Ignores when not view once
  const regularCtx = {
    ...imageCtx,
    fromMe: false,
    findMedia: () => ({
      type: 'imageMessage',
      node: {},
      viewOnce: false,
    }),
  };
  const handledRegular = await forwarder.handleMessage(regularCtx, fakeSock);
  assert.equal(handledRegular, false);
  assert.equal(sentMessages.length, 0);

  // 6. Download failure is handled safely without throwing
  let errorLogged = false;
  const failLogger = {
    info: () => {},
    warn: () => {},
    error: () => {
      errorLogged = true;
    },
  };
  const failForwarder = new ViewOnceForwarder({ logger: failLogger });
  await failForwarder.setTarget(targetGroup);

  const failingCtx = {
    ...imageCtx,
    download: async () => {
      throw new Error('Download timeout');
    },
  };
  const handledFail = await failForwarder.handleMessage(failingCtx, fakeSock);
  assert.equal(handledFail, false);
  assert.equal(errorLogged, true);

  // 7. Deduplication: identical messageId from same chat is ignored on re-delivery
  sentMessages.length = 0;
  const dedupeCtx = {
    ...imageCtx,
    messageId: 'msg-unique-123',
    download: async () => Buffer.from('image-bytes'),
  };
  const handledFirst = await forwarder.handleMessage(dedupeCtx, fakeSock);
  assert.equal(handledFirst, true);
  assert.equal(sentMessages.length, 1);

  const handledSecond = await forwarder.handleMessage(dedupeCtx, fakeSock);
  assert.equal(handledSecond, false);
  assert.equal(sentMessages.length, 1); // No new message sent

  // 8. Graceful fallback when groupSubject is missing or undefined
  sentMessages.length = 0;
  const noSubjectCtx = {
    ...imageCtx,
    messageId: 'msg-no-subject-456',
    groupSubject: undefined, // omitted / not a function
    download: async () => Buffer.from('image-bytes'),
  };
  const handledNoSubject = await forwarder.handleMessage(noSubjectCtx, fakeSock);
  assert.equal(handledNoSubject, true);
  assert.equal(sentMessages.length, 1);
});

test('P3: AvoCommand subcommands authorization, set, unset, status, and validation', async () => {
  let targetSaved = null;
  const mockForwarder = {
    get targetJid() {
      return targetSaved;
    },
    setTarget: async (jid) => {
      targetSaved = jid;
    },
    clearTarget: async () => {
      targetSaved = null;
    },
  };

  const mockGroups = {
    groups: () => [
      ['120363000000000001@g.us', 'Grup A'],
      ['120363000000000002@g.us', 'Grup B'],
    ],
  };

  const avo = new AvoCommand({
    cache: { recall: () => null },
    prefix: '.',
    ownerOnly: false,
    forwarder: mockForwarder,
    owners: { isOwner: (ctx) => Boolean(ctx.isOwner) },
    groups: mockGroups,
  });

  const makeCtx = (args) => {
    let replyText = '';
    let reacted = '';
    return {
      isOwner: args.isOwner ?? false,
      isGroup: args.isGroup ?? false,
      jid: args.jid ?? 'user@s.whatsapp.net',
      senderLabel: 'Tester',
      react: async (r) => {
        reacted = r;
      },
      reply: async (text) => {
        replyText = text;
        return { key: { id: 'reply-1' } };
      },
      groupSubject: async () => args.subject ?? null,
      findMedia: args.findMedia ?? (() => null),
      get replyText() {
        return replyText;
      },
      get reacted() {
        return reacted;
      },
    };
  };

  // 1. Non-owner attempting .avo set is rejected
  const nonOwnerCtx = makeCtx({ isOwner: false });
  await assert.rejects(
    async () => {
      await avo.execute(nonOwnerCtx, 'set 120363000000000001@g.us');
    },
    (err) => {
      assert.ok(err instanceof BotError);
      assert.match(err.userMessage, /khusus owner bot/);
      return true;
    },
  );

  // 2. Non-owner attempting .avo unset is rejected
  await assert.rejects(
    async () => {
      await avo.execute(nonOwnerCtx, 'unset');
    },
    (err) => {
      assert.ok(err instanceof BotError);
      assert.match(err.userMessage, /khusus owner bot/);
      return true;
    },
  );

  // 3. Non-owner attempting .avo status is rejected
  await assert.rejects(
    async () => {
      await avo.execute(nonOwnerCtx, 'status');
    },
    (err) => {
      assert.ok(err instanceof BotError);
      assert.match(err.userMessage, /khusus owner bot/);
      return true;
    },
  );

  // 4. Owner running .avo status when not set
  const ownerCtx = makeCtx({ isOwner: true });
  await avo.execute(ownerCtx, 'status');
  assert.match(ownerCtx.replyText, /Nonaktif/);

  // 5. Owner running .avo set without argument in 1:1 chat -> rejected
  await assert.rejects(
    async () => {
      await avo.execute(ownerCtx, 'set');
    },
    (err) => {
      assert.ok(err instanceof BotError);
      assert.match(err.userMessage, /Sertakan ID grup tujuan/);
      return true;
    },
  );

  // 6. Owner running .avo set with invalid JID
  await assert.rejects(
    async () => {
      await avo.execute(ownerCtx, 'set invalid-jid-format');
    },
    (err) => {
      assert.ok(err instanceof BotError);
      assert.match(err.userMessage, /ID grup tidak valid/);
      return true;
    },
  );

  // 7. Owner running .avo set without argument IN A GROUP -> uses current group
  const groupOwnerCtx = makeCtx({
    isOwner: true,
    isGroup: true,
    jid: '120363099999999999@g.us',
    subject: 'Grup Saya',
  });
  await avo.execute(groupOwnerCtx, 'set');
  assert.equal(targetSaved, '120363099999999999@g.us');
  assert.equal(groupOwnerCtx.reacted, '✅');
  assert.match(groupOwnerCtx.replyText, /Grup Saya/);

  // 8. Owner running .avo status when configured
  const statusCtx = makeCtx({ isOwner: true });
  await avo.execute(statusCtx, 'status');
  assert.match(statusCtx.replyText, /Aktif/);
  assert.match(statusCtx.replyText, /120363099999999999@g\.us/);

  // 9. Owner running .avo set with group index number from list
  const indexCtx = makeCtx({ isOwner: true });
  await avo.execute(indexCtx, 'set 2');
  assert.equal(targetSaved, '120363000000000002@g.us');
  assert.match(indexCtx.replyText, /Grup B/);

  // 10. Owner running .avo unset
  const unsetCtx = makeCtx({ isOwner: true });
  await avo.execute(unsetCtx, 'unset');
  assert.equal(targetSaved, null);
  assert.equal(unsetCtx.reacted, '✅');
  assert.match(unsetCtx.replyText, /dinonaktifkan/);

  // 11. .avo help displays guide and owner subcommands for owner
  const helpOwnerCtx = makeCtx({ isOwner: true });
  await avo.execute(helpOwnerCtx, 'help');
  assert.match(helpOwnerCtx.replyText, /Perintah Khusus Owner/);
  assert.match(helpOwnerCtx.replyText, /avo set/);

  // .avo help displays guide without owner subcommands for non-owner
  const helpUserCtx = makeCtx({ isOwner: false });
  await avo.execute(helpUserCtx, 'help');
  assert.doesNotMatch(helpUserCtx.replyText, /Perintah Khusus Owner/);

  // 12. Owner running .avo set with out-of-range index throws error
  await assert.rejects(
    async () => {
      await avo.execute(ownerCtx, 'set 99');
    },
    (err) => {
      assert.ok(err instanceof BotError);
      assert.match(err.userMessage, /Nomor grup \*99\* tidak ada/);
      return true;
    },
  );

  // 13. Owner running .avo set with angle brackets: .avo set <120363000000000001@g.us>
  const bracketCtx = makeCtx({ isOwner: true });
  await avo.execute(bracketCtx, 'set <120363000000000001@g.us>');
  assert.equal(targetSaved, '120363000000000001@g.us');
  assert.match(bracketCtx.replyText, /Grup A/);

  // 14. Owner running .avo set with short non-index JID e.g. 99@g.us
  await assert.rejects(
    async () => {
      await avo.execute(ownerCtx, 'set 99@g.us');
    },
    (err) => {
      assert.ok(err instanceof BotError);
      assert.match(err.userMessage, /ID grup tidak valid/);
      return true;
    },
  );

  // 15. .avo on alias sets current group
  const onCtx = makeCtx({
    isOwner: true,
    isGroup: true,
    jid: '120363088888888888@g.us',
    subject: 'Grup Aktif',
  });
  await avo.execute(onCtx, 'on');
  assert.equal(targetSaved, '120363088888888888@g.us');
  assert.match(onCtx.replyText, /Grup Aktif/);

  // 16. Calling .avo without media quote when owner displays owner command hints
  const emptyOwnerCtx = makeCtx({ isOwner: true });
  await avo.execute(emptyOwnerCtx, '');
  assert.match(emptyOwnerCtx.replyText, /Perintah Khusus Owner/);
  assert.match(emptyOwnerCtx.replyText, /avo set/);
});

test('P3: MessageHandler mematuhi kebijakan akses untuk View Once (cache & auto-forward)', async () => {
  let forwardedCount = 0;
  let forwardedChat = null;
  let cachedCount = 0;

  const mockForwarder = {
    handleMessage: async (ctx) => {
      forwardedCount++;
      forwardedChat = ctx.jid;
      return true;
    },
  };

  const groupsDisabled = new Set(['1203630disabled@g.us']);
  const mockGroups = {
    groups: () => [['1203630disabled@g.us', 'Disabled Group']],
    isEnabled: (jid) => !groupsDisabled.has(jid),
    privateOnly: false,
    rememberGroup: async () => {},
  };

  const handler = new MessageHandler({
    registry: { resolve: () => null },
    parser: { parse: () => null },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    config: { messageConcurrency: 5, maxInputBytes: 1024 * 1024, staleMessageSeconds: 120 },
    groups: mockGroups,
    owners: { isOwner: () => false },
    viewOnceCache: { remember: () => cachedCount++ },
    forwarder: mockForwarder,
  });

  const fakeSock = {
    user: { id: '628bot@s.whatsapp.net' },
    groupMetadata: async () => ({ subject: 'Test' }),
    sendMessage: async () => ({ key: { id: 'ack' } }),
  };

  // 1. Message in a DISABLED group: TIDAK di-cache dan TIDAK di-forward (kebijakan konsisten)
  const disabledGroupMsg = {
    key: { remoteJid: '1203630disabled@g.us', id: 'm1', fromMe: false },
    message: { conversation: 'hi' },
  };

  handler.handle(fakeSock, { type: 'notify', messages: [disabledGroupMsg] });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(forwardedCount, 0, 'Auto-forward harus diblokir di grup disabled');
  assert.equal(cachedCount, 0, 'Cache .avo tidak mencatat grup disabled');

  // 2. Message in private chat: tetap diproses (cache + forward)
  const privateMsg = {
    key: { remoteJid: '628111222@s.whatsapp.net', id: 'm2', fromMe: false },
    message: { conversation: 'secret' },
  };

  handler.handle(fakeSock, { type: 'notify', messages: [privateMsg] });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(forwardedCount, 1);
  assert.equal(forwardedChat, '628111222@s.whatsapp.net');
  assert.equal(cachedCount, 1);
});

test('P3: JsonStore aliases, fallback paths, and 0-byte safe handling', async () => {
  const tmpDir = path.join(os.tmpdir(), `test-store-alias-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const primaryFile = path.join(tmpDir, 'antiviewonce.json');
  const aliasEmpty = path.join(tmpDir, 'empty.json');
  const aliasData = path.join(tmpDir, 'viewonce.json');

  // Alias 1 is 0 bytes, Alias 2 has data, Primary doesn't exist yet
  await fs.writeFile(aliasEmpty, '   ');
  await fs.writeFile(aliasData, JSON.stringify({ targetJid: '1203630fromalias@g.us' }));

  const store = new JsonStore(primaryFile, { aliases: [aliasEmpty, aliasData] });

  // 1. Loading safely skips 0-byte file and loads from aliasData
  const loaded = await store.load(null);
  assert.deepEqual(loaded, { targetJid: '1203630fromalias@g.us' });

  // 2. Saving writes to primary AND syncs to aliases
  await store.save({ targetJid: '1203630synced@g.us', groupId: '1203630synced@g.us' });

  const primaryContent = JSON.parse(await fs.readFile(primaryFile, 'utf8'));
  const aliasEmptyContent = JSON.parse(await fs.readFile(aliasEmpty, 'utf8'));
  const aliasDataContent = JSON.parse(await fs.readFile(aliasData, 'utf8'));

  assert.equal(primaryContent.targetJid, '1203630synced@g.us');
  assert.equal(aliasEmptyContent.targetJid, '1203630synced@g.us');
  assert.equal(aliasDataContent.targetJid, '1203630synced@g.us');

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test('P3: ViewOnceForwarder schema flexibility (groupId, idGroup, target, raw string)', async () => {
  const tmpDir = path.join(os.tmpdir(), `test-vof-schema-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });

  // 1. groupId schema
  const file1 = path.join(tmpDir, 'groupid.json');
  await fs.writeFile(file1, JSON.stringify({ groupId: '1203630groupid@g.us' }));
  const f1 = new ViewOnceForwarder({ store: new JsonStore(file1) });
  await f1.init();
  assert.equal(f1.targetJid, '1203630groupid@g.us');

  // 2. idGroup schema
  const file2 = path.join(tmpDir, 'idgroup.json');
  await fs.writeFile(file2, JSON.stringify({ idGroup: '1203630idgroup@g.us' }));
  const f2 = new ViewOnceForwarder({ store: new JsonStore(file2) });
  await f2.init();
  assert.equal(f2.targetJid, '1203630idgroup@g.us');

  // 3. raw string
  const file3 = path.join(tmpDir, 'rawstring.json');
  await fs.writeFile(file3, JSON.stringify('1203630rawstring@g.us'));
  const f3 = new ViewOnceForwarder({ store: new JsonStore(file3) });
  await f3.init();
  assert.equal(f3.targetJid, '1203630rawstring@g.us');

  // 4. Persistence writes targetJid only (skema redundan groupId/idGroup tidak ditulis lagi)
  await f3.setTarget('1203630saved@g.us');
  const savedContent = JSON.parse(await fs.readFile(file3, 'utf8'));
  assert.equal(savedContent.targetJid, '1203630saved@g.us');
  assert.equal(savedContent.groupId, undefined, 'Skema redundan groupId tidak lagi ditulis');
  assert.equal(savedContent.idGroup, undefined, 'Skema redundan idGroup tidak lagi ditulis');
  assert.ok(savedContent.updatedAt);

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test('P3: AvoCommand extended argument parsing and command aliases', async () => {
  let targetSaved = null;
  const mockForwarder = {
    get targetJid() {
      return targetSaved;
    },
    setTarget: async (jid) => {
      targetSaved = jid;
    },
    clearTarget: async () => {
      targetSaved = null;
    },
  };

  const avo = new AvoCommand({
    cache: { recall: () => null },
    prefix: '.',
    ownerOnly: false,
    forwarder: mockForwarder,
    owners: { isOwner: () => true },
  });

  const makeCtx = () => {
    let replyText = '';
    let reacted = '';
    return {
      isGroup: false,
      jid: 'user@s.whatsapp.net',
      senderLabel: 'Tester',
      react: async (r) => {
        reacted = r;
      },
      reply: async (text) => {
        replyText = text;
        return { key: { id: 'reply-1' } };
      },
      get replyText() {
        return replyText;
      },
      get reacted() {
        return reacted;
      },
    };
  };

  // 1. .avo set group 120363011111111111@g.us
  const ctx1 = makeCtx();
  await avo.execute(ctx1, 'set group 120363011111111111@g.us');
  assert.equal(targetSaved, '120363011111111111@g.us');
  assert.equal(ctx1.reacted, '✅');

  // 2. .avo set [120363022222222222@g.us]
  const ctx2 = makeCtx();
  await avo.execute(ctx2, 'set [120363022222222222@g.us]');
  assert.equal(targetSaved, '120363022222222222@g.us');

  // 3. .avo set < 120363033333333333@g.us >
  const ctx3 = makeCtx();
  await avo.execute(ctx3, 'set < 120363033333333333@g.us >');
  assert.equal(targetSaved, '120363033333333333@g.us');

  // 4. .avo setgroup 120363044444444444@g.us
  const ctx4 = makeCtx();
  await avo.execute(ctx4, 'setgroup 120363044444444444@g.us');
  assert.equal(targetSaved, '120363044444444444@g.us');

  // 5. .avo cek / .avo info status aliases
  const ctx5 = makeCtx();
  await avo.execute(ctx5, 'cek');
  assert.match(ctx5.replyText, /Aktif/);
  assert.match(ctx5.replyText, /120363044444444444@g\.us/);

  const ctx6 = makeCtx();
  await avo.execute(ctx6, 'info');
  assert.match(ctx6.replyText, /Aktif/);
});

test('P3: End-to-End: .avo set persists to antiviewonce.json, reloads on restart, and forwards View Once message', async () => {
  const tmpDir = path.join(os.tmpdir(), `test-e2e-avo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const primaryFile = path.join(tmpDir, 'antiviewonce.json');
  const aliasFile = path.join(tmpDir, 'viewonce.json');

  const store = new JsonStore(primaryFile, { aliases: [aliasFile] });
  const forwarder = new ViewOnceForwarder({ store });
  await forwarder.init();

  const avo = new AvoCommand({
    cache: { recall: () => null },
    prefix: '.',
    ownerOnly: false,
    forwarder,
    owners: { isOwner: () => true },
  });

  // Step 1: User sets target group via .avo set
  let replyMsg = '';
  const ctx = {
    isGroup: false,
    jid: 'owner@s.whatsapp.net',
    senderLabel: 'Owner',
    react: async () => {},
    reply: async (t) => {
      replyMsg = t;
    },
  };
  await avo.execute(ctx, 'set 120363098765432100@g.us');
  assert.match(replyMsg, /AUTO-FORWARD VIEW ONCE DIAKTIFKAN/);

  // Step 2: Verify persisted file (format tunggal: targetJid) — alias sync tetap berjalan via JsonStore
  const primaryData = JSON.parse(await fs.readFile(primaryFile, 'utf8'));
  const aliasData = JSON.parse(await fs.readFile(aliasFile, 'utf8'));
  assert.equal(primaryData.targetJid, '120363098765432100@g.us');
  assert.equal(primaryData.groupId, undefined, 'Format tunggal: groupId tidak lagi ditulis');
  assert.equal(aliasData.targetJid, '120363098765432100@g.us');

  // Step 3: Bot restart simulation -> fresh instance loads from disk
  const freshStore = new JsonStore(primaryFile, { aliases: [aliasFile] });
  const restartedForwarder = new ViewOnceForwarder({ store: freshStore });
  await restartedForwarder.init();
  assert.equal(restartedForwarder.targetJid, '120363098765432100@g.us');
  assert.equal(restartedForwarder.isConfigured, true);

  // Step 4: Incoming View Once message is forwarded to 120363098765432100@g.us
  const forwardedMessages = [];
  const fakeSock = {
    sendMessage: async (jid, content) => {
      forwardedMessages.push({ jid, content });
      return { key: { id: 'ack-e2e' } };
    },
  };

  const incomingViewOnceCtx = {
    jid: '1203630incoming@g.us',
    isGroup: true,
    fromMe: false,
    senderLabel: 'Pengirim (628111)',
    chatLabel: 'Grup Pengirim',
    groupSubject: async () => 'Grup Asal',
    findMedia: () => ({
      type: 'imageMessage',
      node: { caption: 'Foto Rahasia View Once' },
      viewOnce: true,
    }),
    download: async () => Buffer.from('image-content-bytes'),
  };

  const handled = await restartedForwarder.handleMessage(incomingViewOnceCtx, fakeSock);
  assert.equal(handled, true);
  assert.equal(forwardedMessages.length, 1);
  assert.equal(forwardedMessages[0].jid, '120363098765432100@g.us');
  assert.match(forwardedMessages[0].content.caption, /FORWARDED VIEW ONCE/);
  assert.match(forwardedMessages[0].content.caption, /Foto Rahasia View Once/);
  assert.match(forwardedMessages[0].content.caption, /Grup Asal/);

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test('P3: AvoCommand handles literal groupid and <idGroup> inside groups and gives clear guidance in 1:1', async () => {
  let targetSaved = null;
  const mockForwarder = {
    get targetJid() {
      return targetSaved;
    },
    setTarget: async (jid) => {
      targetSaved = jid;
    },
    clearTarget: async () => {
      targetSaved = null;
    },
  };

  const avo = new AvoCommand({
    cache: { recall: () => null },
    prefix: '.',
    ownerOnly: false,
    forwarder: mockForwarder,
    owners: { isOwner: () => true },
  });

  const makeCtx = (options = {}) => {
    let replyText = '';
    let reacted = '';
    return {
      isGroup: Boolean(options.isGroup),
      jid: options.jid || '1203630testgroup@g.us',
      senderLabel: 'Tester',
      react: async (r) => {
        reacted = r;
      },
      reply: async (t) => {
        replyText = t;
        return { key: { id: 'reply-1' } };
      },
      get replyText() {
        return replyText;
      },
      get reacted() {
        return reacted;
      },
    };
  };

  // 1. Inside group: user types ".avo set groupid" -> sets current group
  const ctx1 = makeCtx({ isGroup: true, jid: '120363011111111111@g.us' });
  await avo.execute(ctx1, 'set groupid');
  assert.equal(targetSaved, '120363011111111111@g.us');
  assert.equal(ctx1.reacted, '✅');
  assert.match(ctx1.replyText, /AUTO-FORWARD VIEW ONCE DIAKTIFKAN/);

  // 2. Inside group: user types ".avo set <idGroup>" -> sets current group
  targetSaved = null;
  const ctx2 = makeCtx({ isGroup: true, jid: '120363022222222222@g.us' });
  await avo.execute(ctx2, 'set <idGroup>');
  assert.equal(targetSaved, '120363022222222222@g.us');

  // 3. Inside group: user types ".avo setgroupid" without args -> sets current group
  targetSaved = null;
  const ctx3 = makeCtx({ isGroup: true, jid: '120363033333333333@g.us' });
  await avo.execute(ctx3, 'setgroupid');
  assert.equal(targetSaved, '120363033333333333@g.us');

  // 4. In 1:1 chat: user types ".avo set groupid" -> helpful guidance error
  const ctx4 = makeCtx({ isGroup: false, jid: 'user@s.whatsapp.net' });
  await assert.rejects(
    async () => {
      await avo.execute(ctx4, 'set groupid');
    },
    (err) => {
      assert.ok(err instanceof BotError);
      assert.match(err.userMessage, /bukan kata placeholder/);
      return true;
    },
  );

  // 5. User types ".avo set groupid: 120363044444444444@g.us" -> prefix stripped cleanly
  targetSaved = null;
  const ctx5 = makeCtx({ isGroup: false });
  await avo.execute(ctx5, 'set groupid: 120363044444444444@g.us');
  assert.equal(targetSaved, '120363044444444444@g.us');

  // 6. User types ".avo setgroupid 120363055555555555@g.us" -> action recognized
  targetSaved = null;
  const ctx6 = makeCtx({ isGroup: false });
  await avo.execute(ctx6, 'setgroupid 120363055555555555@g.us');
  assert.equal(targetSaved, '120363055555555555@g.us');
});

test('P3: ViewOnceForwarder initializes disk file if missing or 0-byte, preventing empty JSON on startup', async () => {
  const tmpDir = path.join(os.tmpdir(), `test-init-file-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });

  const primaryFile = path.join(tmpDir, 'antiviewonce.json');
  const commaAlias = path.join(tmpDir, 'antiviewonce,json');

  const store = new JsonStore(primaryFile, { aliases: [commaAlias] });
  const forwarder = new ViewOnceForwarder({ store });

  // On init without existing file, it creates the file with structured JSON
  await forwarder.init();

  const fileExists = await fs.stat(primaryFile).then(() => true).catch(() => false);
  assert.equal(fileExists, true);

  const content = JSON.parse(await fs.readFile(primaryFile, 'utf8'));
  assert.equal(content.targetJid, null);
  assert.equal(content.groupId, undefined, 'Format tunggal: groupId tidak lagi ditulis');
  assert.equal(content.idGroup, undefined, 'Format tunggal: idGroup tidak lagi ditulis');
  assert.ok(content.updatedAt);

  // Comma alias is also populated
  const commaExists = await fs.stat(commaAlias).then(() => true).catch(() => false);
  assert.equal(commaExists, true);

  // When setting target, both primary and comma alias are updated
  await forwarder.setTarget('120363099999999999@g.us');
  const updatedPrimary = JSON.parse(await fs.readFile(primaryFile, 'utf8'));
  const updatedComma = JSON.parse(await fs.readFile(commaAlias, 'utf8'));
  assert.equal(updatedPrimary.targetJid, '120363099999999999@g.us');
  assert.equal(updatedComma.targetJid, '120363099999999999@g.us');

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test('P3: ViewOnceForwarder handles ptvMessage (video note) and text property fallback', async () => {
  const targetGroup = '1203630dest@g.us';
  const forwarder = new ViewOnceForwarder();
  await forwarder.setTarget(targetGroup);

  const sentMessages = [];
  const fakeSock = {
    sendMessage: async (jid, content) => {
      sentMessages.push({ jid, content });
      return { key: { id: 'ack-ptv' } };
    },
  };

  const ptvCtx = {
    jid: '1203630source@g.us',
    isGroup: true,
    fromMe: false,
    senderLabel: 'Dave (628123456)',
    chatLabel: 'Grup',
    groupSubject: async () => 'Keluarga',
    findMedia: () => ({
      type: 'ptvMessage',
      node: { text: 'Video Catatan Rahasia' },
      viewOnce: true,
    }),
    download: async () => Buffer.from('ptv-bytes'),
  };

  const handled = await forwarder.handleMessage(ptvCtx, fakeSock);
  assert.equal(handled, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].jid, targetGroup);
  assert.ok(sentMessages[0].content.video);
  assert.match(sentMessages[0].content.caption, /Video Catatan Rahasia/);
  assert.match(sentMessages[0].content.caption, /Keluarga/);
});
