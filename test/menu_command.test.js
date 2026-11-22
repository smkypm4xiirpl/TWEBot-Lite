import test from 'node:test';
import assert from 'node:assert/strict';
import { MenuCommand } from '../src/commands/MenuCommand.js';
import { CommandRegistry } from '../src/core/CommandRegistry.js';
import { CommandParser } from '../src/core/CommandParser.js';
import { OwnerPolicy } from '../src/core/OwnerPolicy.js';
import { MessageHandler } from '../src/core/MessageHandler.js';

test('MenuCommand: metadata, name, aliases, and availability flags', () => {
  const cmd = new MenuCommand();
  assert.equal(cmd.name, 'menu');
  assert.deepEqual(cmd.aliases, ['help']);
  assert.equal(cmd.alwaysAvailable, true);
  assert.equal(cmd.ownerOnly, false);
});

test('MenuCommand: CommandRegistry registration and resolution for menu and help', () => {
  const registry = new CommandRegistry();
  const cmd = new MenuCommand({ botName: 'TestBot', prefix: '.' });
  registry.register(cmd);

  assert.equal(registry.resolve('menu'), cmd);
  assert.equal(registry.resolve('help'), cmd);
  assert.equal(registry.resolve('MENU'), null); // parser normalizes to lowercase
});

test('MenuCommand: regular user menu hides owner commands and avo management', async () => {
  const owners = new OwnerPolicy(['6289999999999']);
  const cmd = new MenuCommand({
    botName: 'TWEBot-Lite',
    prefix: '.',
    owners,
    uptimeProvider: () => 3725, // 1 hour, 2 minutes, 5 seconds
  });

  let repliedText = null;
  let reactedEmoji = null;

  const fakeCtx = {
    pushName: 'Andi Pratama',
    senderLabel: '6281234567890',
    identityUsers: ['6281234567890'],
    fromMe: false,
    react: (emoji) => {
      reactedEmoji = emoji;
      return Promise.resolve();
    },
    reply: async (text) => {
      repliedText = text;
      return { key: { id: 'ack-1' } };
    },
  };

  await cmd.execute(fakeCtx);

  assert.equal(reactedEmoji, '✨');
  assert.ok(repliedText, 'Menu text should not be empty');

  // Header checks
  assert.ok(repliedText.includes('TWEBot-Lite'));
  assert.ok(repliedText.includes('Andi Pratama'));
  assert.ok(repliedText.includes('Standard User'));
  assert.ok(repliedText.includes('1 hour, 2 minutes, 5 seconds'));
  assert.ok(repliedText.includes('[ . ]'));

  // Standard categories present
  assert.ok(repliedText.includes('CONVERT & STICKER'));
  assert.ok(repliedText.includes('.s'));
  assert.ok(repliedText.includes('.smeme'));
  assert.ok(repliedText.includes('.brat'));
  assert.ok(repliedText.includes('.toimg'));
  assert.ok(repliedText.includes('.tovid'));
  assert.ok(repliedText.includes('ANTI VIEW ONCE'));
  assert.ok(repliedText.includes('.avo'));
  assert.ok(repliedText.includes('UTILITY & INFO'));
  assert.ok(repliedText.includes('.ping'));
  assert.ok(repliedText.includes('.getpp'));

  // Owner features must be HIDDEN from regular users
  assert.ok(!repliedText.includes('OWNER CONTROL'), 'Owner section must be hidden');
  assert.ok(!repliedText.includes('.bot'), 'Bot command must be hidden');
  assert.ok(!repliedText.includes('.avo status'), 'Avo status must be hidden');
  assert.ok(!repliedText.includes('.avo set'), 'Avo set must be hidden');
  assert.ok(!repliedText.includes('.avo unset'), 'Avo unset must be hidden');
});

test('MenuCommand: owner menu reveals owner control and avo management subcommands', async () => {
  const owners = new OwnerPolicy(['6289999999999']);
  const cmd = new MenuCommand({
    botName: 'TWEBot-Lite',
    prefix: '!',
    owners,
    uptimeProvider: () => 7200,
  });

  let repliedText = null;

  const fakeCtx = {
    pushName: 'Admin Boss',
    senderLabel: '6289999999999',
    identityUsers: ['6289999999999'],
    fromMe: false,
    react: () => Promise.resolve(),
    reply: async (text) => {
      repliedText = text;
      return { key: { id: 'ack-2' } };
    },
  };

  await cmd.execute(fakeCtx);

  assert.ok(repliedText);
  // Status check
  assert.ok(repliedText.includes('👑 Owner'));
  assert.ok(repliedText.includes('Admin Boss'));
  assert.ok(repliedText.includes('[ ! ]'));

  // Anti view once owner subcommands present
  assert.ok(repliedText.includes('!avo status'));
  assert.ok(repliedText.includes('!avo set'));
  assert.ok(repliedText.includes('!avo unset'));

  // Owner section present
  assert.ok(repliedText.includes('👑 *OWNER CONTROL*'));
  assert.ok(repliedText.includes('!bot status'));
  assert.ok(repliedText.includes('!bot list'));
  assert.ok(repliedText.includes('!bot allow'));
  assert.ok(repliedText.includes('!bot disallow'));
  assert.ok(repliedText.includes('!bot on'));
  assert.ok(repliedText.includes('!bot off'));
  assert.ok(repliedText.includes('!bot reset'));
  assert.ok(repliedText.includes('!bot default'));
});

test('MenuCommand: fromMe messages automatically recognized as owner', () => {
  const cmd = new MenuCommand({ botName: 'MyBot', prefix: '.' });
  const fakeCtx = {
    fromMe: true,
    pushName: 'Bot Self',
  };

  const menu = cmd.buildMenu(fakeCtx);
  assert.ok(menu.includes('👑 Owner'));
  assert.ok(menu.includes('OWNER CONTROL'));
  assert.ok(menu.includes('.avo status'));
});

test('MenuCommand: fallback for missing pushName and empty context', () => {
  const cmd = new MenuCommand();
  const menu1 = cmd.buildMenu({ senderLabel: '628111111' });
  assert.ok(menu1.includes('628111111'));
  assert.ok(menu1.includes('Standard User'));

  const menu2 = cmd.buildMenu({});
  assert.ok(menu2.includes('Kak'));

  const menu3 = cmd.buildMenu(null);
  assert.ok(menu3.includes('Kak'));
});

test('MenuCommand: full dispatch integration via MessageHandler (.menu & .help)', async () => {
  const sentMessages = [];
  const fakeSock = {
    user: { id: '628111222333:1@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      sentMessages.push({ jid, content });
      return { key: { id: `ack-${sentMessages.length}` } };
    },
    sendPresenceUpdate: async () => {},
  };

  const owners = new OwnerPolicy(['6289999999999']);
  const menuCmd = new MenuCommand({
    botName: 'TWEBot-Lite',
    prefix: '.',
    owners,
    uptimeProvider: () => 120,
  });

  const registry = new CommandRegistry().register(menuCmd);
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
    isEnabled: () => true,
    hasGroup: () => true,
    groups: () => [],
    rememberGroup: async () => {},
    privateOnly: false,
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

  // 1. Regular user sends .menu
  handler.handle(fakeSock, {
    type: 'notify',
    messages: [
      {
        key: { remoteJid: 'user1@s.whatsapp.net', id: 'msg-menu-1' },
        pushName: 'UserSatu',
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: '.menu' },
      },
    ],
  });

  // Wait tick for async limiter in MessageHandler
  await new Promise((resolve) => setTimeout(resolve, 50));

  const userReply = sentMessages.find((m) => m.content.text?.includes('CONVERT & STICKER'));
  assert.ok(userReply, 'Regular user must receive menu');
  assert.ok(userReply.content.text.includes('Standard User'));
  assert.ok(!userReply.content.text.includes('OWNER CONTROL'));

  // 2. Owner sends .help
  sentMessages.length = 0;
  handler.handle(fakeSock, {
    type: 'notify',
    messages: [
      {
        key: {
          remoteJid: '1203630123@g.us',
          participant: '6289999999999@s.whatsapp.net',
          id: 'msg-help-owner',
        },
        pushName: 'BigBoss',
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: '.help' },
      },
    ],
  });

  await new Promise((resolve) => setTimeout(resolve, 50));

  const ownerReply = sentMessages.find((m) => m.content.text?.includes('CONVERT & STICKER'));
  assert.ok(ownerReply, 'Owner must receive menu via .help');
  assert.ok(ownerReply.content.text.includes('👑 Owner'));
  assert.ok(ownerReply.content.text.includes('OWNER CONTROL'));
  assert.ok(ownerReply.content.text.includes('.bot allow'));
});

test('MenuCommand: alwaysAvailable works in privateOnly mode and disabled groups', async () => {
  const sentMessages = [];
  const fakeSock = {
    user: { id: '628bot@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
      sentMessages.push({ jid, content });
      return { key: { id: `ack-${sentMessages.length}` } };
    },
    sendPresenceUpdate: async () => {},
  };

  const owners = new OwnerPolicy(['6289999999999']);
  const menuCmd = new MenuCommand({
    botName: 'TWEBot-Lite',
    prefix: '.',
    owners,
    uptimeProvider: () => 3600,
  });

  const registry = new CommandRegistry().register(menuCmd);
  const parser = new CommandParser(['.']);
  const dummyLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    command: () => {},
    child: () => dummyLogger,
  };

  // Groups service with privateOnly = true and a disabled group
  const mockGroups = {
    isEnabled: (jid) => jid === '1203630enabled@g.us',
    hasGroup: () => true,
    groups: () => [],
    rememberGroup: async () => {},
    privateOnly: true,
  };

  const handler = new MessageHandler({
    registry,
    parser,
    logger: dummyLogger,
    config: { maxInputBytes: 1024 * 1024, staleMessageSeconds: 9999 },
    groups: mockGroups,
    owners,
    viewOnceCache: { remember: () => {} },
  });

  // 1. Regular user in private chat MUST receive menu even when privateOnly is true
  sentMessages.length = 0;
  handler.handle(fakeSock, {
    type: 'notify',
    messages: [
      {
        key: { remoteJid: '6281111111111@s.whatsapp.net', id: 'msg-pvt-1' },
        pushName: 'PrivateUser',
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: '.menu' },
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const userTextReplies = sentMessages.filter((m) => m.content.text);
  assert.equal(userTextReplies.length, 1, 'Regular user in private chat must get menu in privateOnly mode');
  assert.ok(userTextReplies[0].content.text.includes('Standard User'));

  // 2. Regular user in disabled group must be ignored
  sentMessages.length = 0;
  handler.handle(fakeSock, {
    type: 'notify',
    messages: [
      {
        key: {
          remoteJid: '1203630disabled@g.us',
          participant: '6281111111111@s.whatsapp.net',
          id: 'msg-grp-disabled-user',
        },
        pushName: 'RegularUser',
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: '.menu' },
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sentMessages.length, 0, 'Regular user in disabled group must be ignored');

  // 3. Owner in disabled group MUST receive menu because alwaysAvailable = true
  sentMessages.length = 0;
  handler.handle(fakeSock, {
    type: 'notify',
    messages: [
      {
        key: {
          remoteJid: '1203630disabled@g.us',
          participant: '6289999999999@s.whatsapp.net',
          id: 'msg-grp-disabled-owner',
        },
        pushName: 'BossOwner',
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: '.menu' },
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const ownerTextReplies = sentMessages.filter((m) => m.content.text);
  assert.equal(ownerTextReplies.length, 1, 'Owner in disabled group must receive menu due to alwaysAvailable');
  assert.ok(ownerTextReplies[0].content.text.includes('👑 Owner'));
});

test('MenuCommand: username sanitization, safe error handling, and robust Indonesian fallback', async () => {
  const owners = new OwnerPolicy(['6289999999999']);
  const cmd = new MenuCommand({
    botName: 'TWEBot-Lite',
    prefix: '.',
    owners,
  });

  // 1. Username with newlines is sanitized onto a single line
  const multilineMenu = cmd.buildMenu({
    pushName: 'User\nWith\r\nBreaks',
    senderLabel: '628123',
    identityUsers: ['628123'],
  });
  assert.ok(multilineMenu.includes('User With Breaks'));
  assert.ok(!multilineMenu.includes('User\nWith'));

  // 2. Missing identityUsers with owners policy does not throw
  assert.doesNotThrow(() => {
    cmd.buildMenu({ pushName: 'SafeUser' });
  });

  // 3. Rejecting react() in execute does not throw
  let repliedText = null;
  await assert.doesNotReject(async () => {
    await cmd.execute({
      pushName: 'ReactionTest',
      react: () => Promise.reject(new Error('Network error on reaction')),
      reply: async (text) => {
        repliedText = text;
      },
    });
  });
  assert.ok(repliedText);
});
