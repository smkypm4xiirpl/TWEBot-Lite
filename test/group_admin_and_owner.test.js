import test from 'node:test';
import assert from 'node:assert/strict';
import { CloseGcCommand } from '../src/commands/CloseGcCommand.js';
import { OpenGcCommand } from '../src/commands/OpenGcCommand.js';
import { GroupSettingCommand, GroupAdminCommand } from '../src/commands/GroupSettingCommand.js';
import { MenuCommand } from '../src/commands/MenuCommand.js';
import { PingCommand } from '../src/commands/PingCommand.js';
import { OwnerPolicy } from '../src/core/OwnerPolicy.js';
import { CommandRegistry } from '../src/core/CommandRegistry.js';
import { CommandParser } from '../src/core/CommandParser.js';
import { MessageHandler } from '../src/core/MessageHandler.js';
import { MessageContext } from '../src/core/MessageContext.js';
import { BotError } from '../src/errors/BotError.js';

test('CloseGcCommand: metadata, name, aliases, and registry resolution', () => {
  const cmd = new CloseGcCommand();
  assert.equal(cmd.name, 'closegc');
  assert.ok(cmd.aliases.includes('tutup'));
  assert.ok(cmd.aliases.includes('close'));
  assert.ok(cmd.aliases.includes('gcclose'));
  assert.equal(cmd.targetSetting, 'announcement');
  assert.equal(cmd.ownerOnly, false);
  assert.equal(cmd.alwaysAvailable, false);

  const registry = new CommandRegistry();
  registry.register(cmd);
  assert.equal(registry.resolve('closegc'), cmd);
  assert.equal(registry.resolve('tutup'), cmd);
  assert.equal(registry.resolve('close'), cmd);
  assert.equal(registry.resolve('gcclose'), cmd);
});

test('OpenGcCommand: metadata, name, aliases, and registry resolution', () => {
  const cmd = new OpenGcCommand();
  assert.equal(cmd.name, 'opengc');
  assert.ok(cmd.aliases.includes('buka'));
  assert.ok(cmd.aliases.includes('open'));
  assert.ok(cmd.aliases.includes('gcopen'));
  assert.equal(cmd.targetSetting, 'not_announcement');
  assert.equal(cmd.ownerOnly, false);
  assert.equal(cmd.alwaysAvailable, false);

  const registry = new CommandRegistry();
  registry.register(cmd);
  assert.equal(registry.resolve('opengc'), cmd);
  assert.equal(registry.resolve('buka'), cmd);
  assert.equal(registry.resolve('open'), cmd);
  assert.equal(registry.resolve('gcopen'), cmd);
});

test('GroupAdminCommand alias is exported and equivalent to GroupSettingCommand', () => {
  assert.equal(GroupAdminCommand, GroupSettingCommand);
});

test('CloseGcCommand: throws when executed outside of group', async () => {
  const cmd = new CloseGcCommand();
  const fakeCtx = {
    isGroup: false,
    senderLabel: 'User 1',
    jid: '628123456789@s.whatsapp.net',
  };

  await assert.rejects(
    () => cmd.execute(fakeCtx),
    (err) => {
      assert.ok(err instanceof BotError);
      assert.ok(err.userMessage.includes('hanya dapat digunakan di dalam grup'));
      return true;
    },
  );
});

test('CloseGcCommand: throws when bot is not an admin in the group', async () => {
  const owners = new OwnerPolicy(['628000000000']);
  const cmd = new CloseGcCommand({ owners });

  const fakeSock = {
    user: { id: '628111222333:1@s.whatsapp.net' },
    groupMetadata: async () => ({
      id: '1203630123@g.us',
      participants: [
        { id: '628111222333@s.whatsapp.net', admin: null }, // Bot is NOT admin
        { id: '628999888777@s.whatsapp.net', admin: 'admin' }, // Caller is admin
      ],
    }),
  };

  const fakeCtx = {
    isGroup: true,
    jid: '1203630123@g.us',
    senderLabel: 'Caller',
    identityUsers: ['628999888777'],
    sock: fakeSock,
  };

  await assert.rejects(
    () => cmd.execute(fakeCtx),
    (err) => {
      assert.ok(err instanceof BotError);
      assert.ok(err.userMessage.includes('Bot harus menjadi admin grup terlebih dahulu'));
      return true;
    },
  );
});

test('CloseGcCommand: throws when caller is a regular member (neither admin nor owner)', async () => {
  const owners = new OwnerPolicy(['628000000000']);
  const cmd = new CloseGcCommand({ owners });

  const fakeSock = {
    user: { id: '628111222333:1@s.whatsapp.net' },
    groupMetadata: async () => ({
      id: '1203630123@g.us',
      participants: [
        { id: '628111222333@s.whatsapp.net', admin: 'admin' }, // Bot is admin
        { id: '628555444333@s.whatsapp.net', admin: 'superadmin' }, // Group creator
        { id: '628777666555@s.whatsapp.net', admin: null }, // Regular user (caller)
      ],
    }),
  };

  const fakeCtx = {
    isGroup: true,
    jid: '1203630123@g.us',
    senderLabel: 'RegularUser',
    identityUsers: ['628777666555'],
    sock: fakeSock,
  };

  await assert.rejects(
    () => cmd.execute(fakeCtx),
    (err) => {
      assert.ok(err instanceof BotError);
      assert.ok(err.userMessage.includes('hanya dapat digunakan oleh admin grup atau owner bot'));
      return true;
    },
  );
});

test('CloseGcCommand: succeeds when caller is a group admin', async () => {
  const owners = new OwnerPolicy(['628000000000']);
  const cmd = new CloseGcCommand({ owners });

  let updatedSetting = null;
  let updatedJid = null;
  const reactions = [];
  let replyText = null;

  const fakeSock = {
    user: { id: '628111222333:1@s.whatsapp.net' },
    groupMetadata: async () => ({
      id: '1203630123@g.us',
      participants: [
        { id: '628111222333@s.whatsapp.net', admin: 'admin' }, // Bot is admin
        { id: '628555444333@s.whatsapp.net', admin: 'admin' }, // Caller is admin
      ],
    }),
    groupSettingUpdate: async (jid, setting) => {
      updatedJid = jid;
      updatedSetting = setting;
    },
  };

  const fakeCtx = {
    isGroup: true,
    jid: '1203630123@g.us',
    senderLabel: 'AdminSiti',
    pushName: 'Siti Admin',
    identityUsers: ['628555444333'],
    sock: fakeSock,
    react: async (emoji) => {
      reactions.push(emoji);
    },
    reply: async (text) => {
      replyText = text;
      return { key: { id: 'reply-1' } };
    },
  };

  await cmd.execute(fakeCtx);

  assert.equal(updatedJid, '1203630123@g.us');
  assert.equal(updatedSetting, 'announcement');
  assert.deepEqual(reactions, ['⏳', '✅']);
  assert.ok(replyText.includes('AKSES GRUP DITUTUP'));
  assert.ok(replyText.includes('Hanya Admin'));
  assert.ok(replyText.includes('Siti Admin'));
});

test('CloseGcCommand: succeeds when caller is bot owner (even if not group admin)', async () => {
  const owners = new OwnerPolicy(['628000000000']);
  const cmd = new CloseGcCommand({ owners });

  let updatedSetting = null;
  let updatedJid = null;
  const reactions = [];
  let replyText = null;

  const fakeSock = {
    user: { id: '628111222333:1@s.whatsapp.net' },
    groupMetadata: async () => ({
      id: '1203630123@g.us',
      participants: [
        { id: '628111222333@s.whatsapp.net', admin: 'admin' }, // Bot is admin
        { id: '628000000000@s.whatsapp.net', admin: null }, // Owner is regular participant in group
      ],
    }),
    groupSettingUpdate: async (jid, setting) => {
      updatedJid = jid;
      updatedSetting = setting;
    },
  };

  const fakeCtx = {
    isGroup: true,
    jid: '1203630123@g.us',
    senderLabel: 'OwnerBoss',
    pushName: 'Boss Owner',
    identityUsers: ['628000000000'],
    sock: fakeSock,
    react: async (emoji) => {
      reactions.push(emoji);
    },
    reply: async (text) => {
      replyText = text;
      return { key: { id: 'reply-2' } };
    },
  };

  await cmd.execute(fakeCtx);

  assert.equal(updatedJid, '1203630123@g.us');
  assert.equal(updatedSetting, 'announcement');
  assert.deepEqual(reactions, ['⏳', '✅']);
  assert.ok(replyText.includes('AKSES GRUP DITUTUP'));
  assert.ok(replyText.includes('Boss Owner'));
});

test('OpenGcCommand: succeeds when caller is group admin', async () => {
  const owners = new OwnerPolicy(['628000000000']);
  const cmd = new OpenGcCommand({ owners });

  let updatedSetting = null;
  let updatedJid = null;
  const reactions = [];
  let replyText = null;

  const fakeSock = {
    user: { id: '628111222333:1@s.whatsapp.net' },
    groupMetadata: async () => ({
      id: '1203630999@g.us',
      participants: [
        { id: '628111222333@s.whatsapp.net', admin: 'admin' },
        { id: '628222333444@s.whatsapp.net', admin: 'superadmin' },
      ],
    }),
    groupSettingUpdate: async (jid, setting) => {
      updatedJid = jid;
      updatedSetting = setting;
    },
  };

  const fakeCtx = {
    isGroup: true,
    jid: '1203630999@g.us',
    senderLabel: 'AdminBudi',
    pushName: 'Budi Superadmin',
    identityUsers: ['628222333444'],
    sock: fakeSock,
    react: async (emoji) => {
      reactions.push(emoji);
    },
    reply: async (text) => {
      replyText = text;
      return { key: { id: 'reply-3' } };
    },
  };

  await cmd.execute(fakeCtx);

  assert.equal(updatedJid, '1203630999@g.us');
  assert.equal(updatedSetting, 'not_announcement');
  assert.deepEqual(reactions, ['⏳', '✅']);
  assert.ok(replyText.includes('AKSES GRUP DIBUKA'));
  assert.ok(replyText.includes('Semua Peserta'));
  assert.ok(replyText.includes('Budi Superadmin'));
});

test('OwnerPolicy: cleanly matches 628000000000 across JID formats, LID, and candidate formats', () => {
  const policy = new OwnerPolicy(['628000000000']);

  assert.equal(policy.configuredCount, 1);

  // 1. fromMe is always owner
  assert.equal(policy.isOwner({ fromMe: true }), true);

  // 2. IdentityUsers with plain digit user
  assert.equal(policy.isOwner({ fromMe: false, identityUsers: ['628000000000'] }), true);

  // 3. IdentityUsers with full WhatsApp JID format
  assert.equal(policy.isOwner({ fromMe: false, identityUsers: ['628000000000@s.whatsapp.net'] }), true);

  // 4. Candidate senderJid
  assert.equal(policy.isOwner({ fromMe: false, senderJid: '628000000000:2@s.whatsapp.net' }), true);

  // 5. Message key participant
  assert.equal(policy.isOwner({ fromMe: false, key: { participant: '628000000000@s.whatsapp.net' } }), true);

  // 6. Direct sender property
  assert.equal(policy.isOwner({ fromMe: false, sender: '628000000000@s.whatsapp.net' }), true);

  // 7. Configured with full JID in constructor
  const policyFromJid = new OwnerPolicy(['628000000000@s.whatsapp.net']);
  assert.equal(policyFromJid.isOwner({ fromMe: false, identityUsers: ['628000000000'] }), true);
  assert.equal(policyFromJid.isOwner({ fromMe: false, senderJid: '628000000000@s.whatsapp.net' }), true);

  // 8. Non-owner is cleanly rejected
  assert.equal(policy.isOwner({ fromMe: false, identityUsers: ['6281234567890'] }), false);
  assert.equal(policy.isOwner({ fromMe: false, senderJid: '6281234567890@s.whatsapp.net' }), false);
  assert.equal(policy.isOwner(null), false);
  assert.equal(policy.isOwner({}), false);
});

test('MessageHandler: owner 628000000000 can run any command in disabled group or privateOnly mode', async () => {
  const sentMessages = [];
  const fakeSock = {
    user: { id: '628111222333:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      sentMessages.push({ jid, content });
      return { key: { id: `ack-${sentMessages.length}` } };
    },
    sendPresenceUpdate: async () => {},
    groupMetadata: async () => ({
      id: '1203630disabled@g.us',
      participants: [
        { id: '628111222333@s.whatsapp.net', admin: 'admin' },
        { id: '628000000000@s.whatsapp.net', admin: null },
      ],
    }),
    groupSettingUpdate: async () => {},
  };

  const owners = new OwnerPolicy(['628000000000']);
  const closeGcCmd = new CloseGcCommand({ owners });
  const openGcCmd = new OpenGcCommand({ owners });
  const registry = new CommandRegistry()
    .register(closeGcCmd)
    .register(openGcCmd);

  const parser = new CommandParser(['.']);
  const dummyLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    command: () => {},
    child: () => dummyLogger,
  };

  // Group is strictly disabled in settings, and privateOnly can be toggled
  let privateOnly = false;
  const dummyGroups = {
    isEnabled: () => false, // Disabled!
    hasGroup: () => true,
    groups: () => [['1203630disabled@g.us', 'Disabled Group']],
    rememberGroup: async () => {},
    get privateOnly() {
      return privateOnly;
    },
  };
  const dummyCache = { remember: () => {} };

  const handler = new MessageHandler({
    registry,
    parser,
    logger: dummyLogger,
    config: { maxInputBytes: 1024 * 1024, staleMessageSeconds: 9999 },
    groups: dummyGroups,
    owners,
    viewOnceCache: dummyCache,
  });

  // 1. Regular user in disabled group sends .closegc -> MUST BE IGNORED
  handler.handle(fakeSock, {
    type: 'notify',
    messages: [
      {
        key: {
          remoteJid: '1203630disabled@g.us',
          participant: '6281234567890@s.whatsapp.net',
          id: 'msg-reg-disabled',
        },
        pushName: 'RegularUser',
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: '.closegc' },
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sentMessages.length, 0, 'Regular user in disabled group must be ignored');

  // 2. Owner 628000000000 in disabled group sends .closegc -> MUST EXECUTE
  sentMessages.length = 0;
  handler.handle(fakeSock, {
    type: 'notify',
    messages: [
      {
        key: {
          remoteJid: '1203630disabled@g.us',
          participant: '628000000000@s.whatsapp.net',
          id: 'msg-owner-closegc',
        },
        pushName: 'OwnerBoss',
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: '.closegc' },
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const ownerCloseReplies = sentMessages.filter((m) => m.content?.text);
  const ownerCloseReactions = sentMessages.filter((m) => m.content?.react).map((m) => m.content.react.text);
  assert.equal(ownerCloseReplies.length, 1, 'Owner in disabled group must execute .closegc');
  assert.ok(ownerCloseReplies[0].content.text.includes('AKSES GRUP DITUTUP'));
  assert.deepEqual(ownerCloseReactions, ['⏳', '✅']);

  // 3. Owner 628000000000 in privateOnly = true mode sends .opengc -> MUST EXECUTE
  privateOnly = true;
  sentMessages.length = 0;
  handler.handle(fakeSock, {
    type: 'notify',
    messages: [
      {
        key: {
          remoteJid: '1203630disabled@g.us',
          participant: '628000000000@s.whatsapp.net',
          id: 'msg-owner-opengc',
        },
        pushName: 'OwnerBoss',
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: '.opengc' },
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const ownerOpenReplies = sentMessages.filter((m) => m.content?.text);
  const ownerOpenReactions = sentMessages.filter((m) => m.content?.react).map((m) => m.content.react.text);
  assert.equal(ownerOpenReplies.length, 1, 'Owner in privateOnly mode must execute .opengc in group');
  assert.ok(ownerOpenReplies[0].content.text.includes('AKSES GRUP DIBUKA'));
  assert.deepEqual(ownerOpenReactions, ['⏳', '✅']);

  // 4. Regular user in privateOnly mode -> MUST BE IGNORED
  sentMessages.length = 0;
  handler.handle(fakeSock, {
    type: 'notify',
    messages: [
      {
        key: {
          remoteJid: '1203630disabled@g.us',
          participant: '6281234567890@s.whatsapp.net',
          id: 'msg-reg-privateonly',
        },
        pushName: 'RegularUser',
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: '.opengc' },
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sentMessages.length, 0, 'Regular user in privateOnly mode must be ignored');
});

test('MenuCommand: displays GROUP SETTING category with .closegc and .opengc', () => {
  const owners = new OwnerPolicy(['628000000000']);
  const cmd = new MenuCommand({
    botName: 'TWEBot-Lite',
    prefix: '.',
    owners,
  });

  const menu = cmd.buildMenu({
    pushName: 'User',
    senderLabel: '628123456789',
    identityUsers: ['628123456789'],
    fromMe: false,
  });

  assert.ok(menu.includes('GROUP SETTING'));
  assert.ok(menu.includes('.closegc'));
  assert.ok(menu.includes('.tutup'));
  assert.ok(menu.includes('.opengc'));
  assert.ok(menu.includes('.buka'));
});

test('OpenGcCommand: throws when executed outside of group', async () => {
  const cmd = new OpenGcCommand();
  const fakeCtx = {
    isGroup: false,
    senderLabel: 'User 1',
    jid: '628123456789@s.whatsapp.net',
  };

  await assert.rejects(
    () => cmd.execute(fakeCtx),
    (err) => {
      assert.ok(err instanceof BotError);
      assert.ok(err.userMessage.includes('hanya dapat digunakan di dalam grup'));
      return true;
    },
  );
});

test('OpenGcCommand: throws when bot is not an admin in the group', async () => {
  const owners = new OwnerPolicy(['628000000000']);
  const cmd = new OpenGcCommand({ owners });

  const fakeSock = {
    user: { id: '628111222333:1@s.whatsapp.net' },
    groupMetadata: async () => ({
      id: '1203630123@g.us',
      participants: [
        { id: '628111222333@s.whatsapp.net', admin: null },
        { id: '628999888777@s.whatsapp.net', admin: 'admin' },
      ],
    }),
  };

  const fakeCtx = {
    isGroup: true,
    jid: '1203630123@g.us',
    senderLabel: 'Caller',
    identityUsers: ['628999888777'],
    sock: fakeSock,
  };

  await assert.rejects(
    () => cmd.execute(fakeCtx),
    (err) => {
      assert.ok(err instanceof BotError);
      assert.ok(err.userMessage.includes('Bot harus menjadi admin grup terlebih dahulu'));
      return true;
    },
  );
});

test('OpenGcCommand: throws when caller is a regular member (neither admin nor owner)', async () => {
  const owners = new OwnerPolicy(['628000000000']);
  const cmd = new OpenGcCommand({ owners });

  const fakeSock = {
    user: { id: '628111222333:1@s.whatsapp.net' },
    groupMetadata: async () => ({
      id: '1203630123@g.us',
      participants: [
        { id: '628111222333@s.whatsapp.net', admin: 'admin' },
        { id: '628777666555@s.whatsapp.net', admin: null },
      ],
    }),
  };

  const fakeCtx = {
    isGroup: true,
    jid: '1203630123@g.us',
    senderLabel: 'RegularUser',
    identityUsers: ['628777666555'],
    sock: fakeSock,
  };

  await assert.rejects(
    () => cmd.execute(fakeCtx),
    (err) => {
      assert.ok(err instanceof BotError);
      assert.ok(err.userMessage.includes('hanya dapat digunakan oleh admin grup atau owner bot'));
      return true;
    },
  );
});

test('OpenGcCommand: succeeds when caller is bot owner (even if not group admin)', async () => {
  const owners = new OwnerPolicy(['628000000000']);
  const cmd = new OpenGcCommand({ owners });

  let updatedSetting = null;
  let updatedJid = null;
  const reactions = [];
  let replyText = null;

  const fakeSock = {
    user: { id: '628111222333:1@s.whatsapp.net' },
    groupMetadata: async () => ({
      id: '1203630123@g.us',
      participants: [
        { id: '628111222333@s.whatsapp.net', admin: 'admin' },
        { id: '628000000000@s.whatsapp.net', admin: null },
      ],
    }),
    groupSettingUpdate: async (jid, setting) => {
      updatedJid = jid;
      updatedSetting = setting;
    },
  };

  const fakeCtx = {
    isGroup: true,
    jid: '1203630123@g.us',
    senderLabel: 'OwnerBoss',
    pushName: 'Boss Owner',
    identityUsers: ['628000000000'],
    sock: fakeSock,
    react: async (emoji) => {
      reactions.push(emoji);
    },
    reply: async (text) => {
      replyText = text;
      return { key: { id: 'reply-open-owner' } };
    },
  };

  await cmd.execute(fakeCtx);

  assert.equal(updatedJid, '1203630123@g.us');
  assert.equal(updatedSetting, 'not_announcement');
  assert.deepEqual(reactions, ['⏳', '✅']);
  assert.ok(replyText.includes('AKSES GRUP DIBUKA'));
  assert.ok(replyText.includes('Boss Owner'));
});

test('GroupSettingCommand: handles bot admin recognition with device suffix, LID, and authState creds', async () => {
  const owners = new OwnerPolicy(['628000000000']);
  const cmd = new CloseGcCommand({ owners });

  let updatedSetting = null;
  const fakeSock = {
    user: null,
    authState: {
      creds: {
        me: { id: '628111222333:5@s.whatsapp.net', lid: '123456789:0@lid' },
      },
    },
    groupMetadata: async () => ({
      id: '1203630123@g.us',
      participants: [
        { id: '628111222333@s.whatsapp.net', admin: 'admin' },
        { id: '628555444333@s.whatsapp.net', admin: 'admin' },
      ],
    }),
    groupSettingUpdate: async (jid, setting) => {
      updatedSetting = setting;
    },
  };

  const fakeCtx = {
    isGroup: true,
    jid: '1203630123@g.us',
    identityUsers: ['628555444333'],
    sock: fakeSock,
    react: async () => {},
    reply: async () => ({ key: { id: 'reply-ok' } }),
  };

  await cmd.execute(fakeCtx);
  assert.equal(updatedSetting, 'announcement');
});

test('GroupSettingCommand: handles caller admin recognition with LID, superadmin, and participantAlt', async () => {
  const owners = new OwnerPolicy(['628000000000']);
  const cmd = new OpenGcCommand({ owners });

  let updatedSetting = null;
  const fakeSock = {
    user: { id: '628111222333:1@s.whatsapp.net' },
    groupMetadata: async () => ({
      id: '1203630123@g.us',
      participants: [
        { id: '628111222333@s.whatsapp.net', admin: 'admin' },
        { id: '9988776655@lid', admin: 'superadmin' },
      ],
    }),
    groupSettingUpdate: async (jid, setting) => {
      updatedSetting = setting;
    },
  };

  const fakeCtx = {
    isGroup: true,
    jid: '1203630123@g.us',
    key: {
      remoteJid: '1203630123@g.us',
      participant: '9988776655@lid',
      participantAlt: '628777666555@s.whatsapp.net',
    },
    identityUsers: ['9988776655', '628777666555'],
    sock: fakeSock,
    react: async () => {},
    reply: async () => ({ key: { id: 'reply-lid' } }),
  };

  await cmd.execute(fakeCtx);
  assert.equal(updatedSetting, 'not_announcement');
});

test('GroupSettingCommand: wraps socket update network error in clear BotError with cause', async () => {
  const owners = new OwnerPolicy(['628000000000']);
  const cmd = new CloseGcCommand({ owners });

  const fakeSock = {
    user: { id: '628111222333:1@s.whatsapp.net' },
    groupMetadata: async () => ({
      id: '1203630123@g.us',
      participants: [
        { id: '628111222333@s.whatsapp.net', admin: 'admin' },
        { id: '628555444333@s.whatsapp.net', admin: 'admin' },
      ],
    }),
    groupSettingUpdate: async () => {
      throw new Error('403 Forbidden: not admin');
    },
  };

  const fakeCtx = {
    isGroup: true,
    jid: '1203630123@g.us',
    identityUsers: ['628555444333'],
    sock: fakeSock,
    react: async () => {},
    reply: async () => {},
  };

  await assert.rejects(
    () => cmd.execute(fakeCtx),
    (err) => {
      assert.ok(err instanceof BotError);
      assert.ok(err.userMessage.includes('Gagal memperbarui setelan grup'));
      assert.ok(err.cause?.message?.includes('403 Forbidden'));
      return true;
    },
  );
});

test('GroupSettingCommand: throws clear BotError when group metadata fetch fails', async () => {
  const owners = new OwnerPolicy(['628000000000']);
  const cmd = new CloseGcCommand({ owners });

  const fakeSock = {
    user: { id: '628111222333:1@s.whatsapp.net' },
    groupMetadata: async () => {
      throw new Error('Network timeout');
    },
  };

  const fakeCtx = {
    isGroup: true,
    jid: '1203630123@g.us',
    identityUsers: ['628555444333'],
    sock: fakeSock,
  };

  await assert.rejects(
    () => cmd.execute(fakeCtx),
    (err) => {
      assert.ok(err instanceof BotError);
      assert.ok(err.userMessage.includes('Gagal memuat informasi grup'));
      return true;
    },
  );
});

test('MessageContext: groupSettingUpdate handles both (setting, jid) and (jid, setting) argument orders', async () => {
  let callA = null;
  let callB = null;
  const fakeSock = {
    groupSettingUpdate: async (jid, setting) => {
      return { jid, setting };
    },
  };

  const fakeMessage = {
    key: { remoteJid: '1203630123@g.us', id: 'm1' },
    message: { conversation: 'test' },
  };

  const ctx = new MessageContext({
    sock: fakeSock,
    message: fakeMessage,
    maxInputBytes: 1024,
  });

  // Call with (jid, setting)
  callA = await ctx.groupSettingUpdate('1203630999@g.us', 'announcement');
  assert.equal(callA.jid, '1203630999@g.us');
  assert.equal(callA.setting, 'announcement');

  // Call with (setting, jid)
  callB = await ctx.groupSettingUpdate('not_announcement', '1203630888@g.us');
  assert.equal(callB.jid, '1203630888@g.us');
  assert.equal(callB.setting, 'not_announcement');

  // Call with default jid (setting)
  const callC = await ctx.groupSettingUpdate('announcement');
  assert.equal(callC.jid, '1203630123@g.us');
  assert.equal(callC.setting, 'announcement');
});

test('OwnerPolicy: accepts raw string and JID format directly into isOwner(str)', () => {
  const policy = new OwnerPolicy(['628000000000']);

  assert.equal(policy.isOwner('628000000000'), true);
  assert.equal(policy.isOwner('628000000000@s.whatsapp.net'), true);
  assert.equal(policy.isOwner('628000000000:1@s.whatsapp.net'), true);
  assert.equal(policy.isOwner('628111222333@s.whatsapp.net'), false);
  assert.equal(policy.isOwner(''), false);
});

test('MessageHandler: owner 628000000000 can run any command in disabled group without restriction', async () => {
  const sentMessages = [];
  const fakeSock = {
    user: { id: '628111222333:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      sentMessages.push({ jid, content });
      return { key: { id: `ack-${sentMessages.length}` } };
    },
    sendPresenceUpdate: async () => {},
  };

  const owners = new OwnerPolicy(['628000000000']);
  const pingCmd = new PingCommand({
    system: { snapshot: async () => ({ os: 'Linux', memory: { freeMb: 100, totalMb: 200, usedPercent: 50 }, nodeVersion: '20' }) },
    provider: { lookup: async () => ({ ip: '1.2.3.4', isp: 'ISP' }) },
    formatter: { format: () => 'Pong!' },
  });

  const registry = new CommandRegistry().register(pingCmd);
  const parser = new CommandParser(['.']);
  const dummyLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    command: () => {},
    child: () => dummyLogger,
  };

  const dummyGroups = {
    isEnabled: () => false, // Group is disabled!
    hasGroup: () => true,
    groups: () => [['1203630disabled@g.us', 'Disabled Group']],
    rememberGroup: async () => {},
    privateOnly: false,
  };

  const handler = new MessageHandler({
    registry,
    parser,
    logger: dummyLogger,
    config: { maxInputBytes: 1024 * 1024, staleMessageSeconds: 9999 },
    groups: dummyGroups,
    owners,
    viewOnceCache: { remember: () => {} },
  });

  // Regular user in disabled group -> ignored
  handler.handle(fakeSock, {
    type: 'notify',
    messages: [
      {
        key: { remoteJid: '1203630disabled@g.us', participant: '6281234567890@s.whatsapp.net', id: 'm-reg' },
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: '.ping' },
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sentMessages.length, 0);

  // Owner in disabled group -> executes .ping!
  handler.handle(fakeSock, {
    type: 'notify',
    messages: [
      {
        key: { remoteJid: '1203630disabled@g.us', participant: '628000000000@s.whatsapp.net', id: 'm-owner' },
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: '.ping' },
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const ownerReplies = sentMessages.filter((m) => m.content?.text);
  assert.equal(ownerReplies.length, 2);
  assert.ok(ownerReplies[0].content.text.includes('Mengukur kecepatan'));
  assert.equal(ownerReplies[1].content.text, 'Pong!');
});
