import test from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '../src/core/Logger.js';
import { MessageExtractor } from '../src/core/MessageExtractor.js';
import { MessageContext } from '../src/core/MessageContext.js';
import { MessageHandler } from '../src/core/MessageHandler.js';
import { MediaDownloader } from '../src/core/MediaDownloader.js';
import { MediaConverter } from '../src/services/MediaConverter.js';
import { StickerCommand } from '../src/commands/StickerCommand.js';
import { AvoCommand } from '../src/commands/AvoCommand.js';
import { ViewOnceForwarder } from '../src/services/ViewOnceForwarder.js';
import { GetPpCommand } from '../src/commands/GetPpCommand.js';
import { PingCommand } from '../src/commands/PingCommand.js';
import { BotCommand } from '../src/commands/BotCommand.js';

test('Debug Logging: Logger.isDebugEnabled and conditional debug execution', () => {
  const loggerOn = new Logger('test', { debug: true });
  assert.equal(loggerOn.isDebugEnabled, true);

  const loggerOff = new Logger('test', { debug: false });
  assert.equal(loggerOff.isDebugEnabled, false);

  const childOn = loggerOn.child('child-test');
  assert.equal(childOn.isDebugEnabled, true);

  // Lazy debug evaluation with function
  let evaluated = false;
  loggerOff.debug(() => {
    evaluated = true;
    return 'should not be called';
  });
  assert.equal(evaluated, false);

  loggerOn.debug(() => {
    evaluated = true;
    return 'should be evaluated';
  });
  assert.equal(evaluated, true);

  // Error and object formatting
  loggerOn.debug(new Error('test debug error'));
  loggerOn.debug({ key: 'val', num: 42 });

  // Trace recognized as debug
  const origEnv = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'trace';
  const loggerTrace = new Logger('trace-test');
  assert.equal(loggerTrace.isDebugEnabled, true);
  process.env.LOG_LEVEL = origEnv;
});

test('Debug Logging: MessageExtractor and MessageContext detectedTypes detection', () => {
  // 1. Text message
  const textMsg = {
    key: { remoteJid: 'user@s.whatsapp.net', id: 'm1' },
    message: { conversation: 'halo bot' },
  };
  const ext1 = new MessageExtractor({ message: textMsg });
  assert.deepEqual(ext1.detectedTypes, ['text']);

  // 2. View-once image message
  const voImgMsg = {
    key: { remoteJid: 'group@g.us', id: 'm2', participant: 'user@s.whatsapp.net' },
    message: {
      viewOnceMessage: {
        message: {
          imageMessage: { caption: 'rahasia' },
        },
      },
    },
  };
  const ext2 = new MessageExtractor({ message: voImgMsg });
  assert.ok(ext2.detectedTypes.includes('image'));
  assert.ok(ext2.detectedTypes.includes('view-once'));

  // 3. Quoted video message
  const replyMsg = {
    key: { remoteJid: 'user@s.whatsapp.net', id: 'm3' },
    message: {
      extendedTextMessage: {
        text: '.s',
        contextInfo: {
          stanzaId: 'parent-1',
          participant: 'user2@s.whatsapp.net',
          quotedMessage: {
            videoMessage: { seconds: 5 },
          },
        },
      },
    },
  };
  const ext3 = new MessageExtractor({ message: replyMsg });
  assert.ok(ext3.detectedTypes.includes('text'));
  assert.ok(ext3.detectedTypes.some((t) => t.includes('quoted:video')));

  // Check MessageContext delegation
  const ctx = new MessageContext({ sock: null, message: replyMsg, maxInputBytes: 1024 });
  assert.deepEqual(ctx.detectedTypes, ext3.detectedTypes);

  // 4. Direct node.viewOnce message (unwrapped)
  const directVoMsg = {
    key: { remoteJid: 'user@s.whatsapp.net', id: 'm4' },
    message: {
      imageMessage: { url: 'https://example.com/img', viewOnce: true },
    },
  };
  const ext4 = new MessageExtractor({ message: directVoMsg });
  assert.ok(ext4.detectedTypes.includes('image'));
  assert.ok(ext4.detectedTypes.includes('view-once'));

  // 5. Quoted message with direct node.viewOnce
  const replyVoMsg = {
    key: { remoteJid: 'user@s.whatsapp.net', id: 'm5' },
    message: {
      extendedTextMessage: {
        text: 'wow',
        contextInfo: {
          quotedMessage: {
            imageMessage: { viewOnce: true },
          },
        },
      },
    },
  };
  const ext5 = new MessageExtractor({ message: replyVoMsg });
  assert.ok(ext5.detectedTypes.some((t) => t.includes('quoted:image (view-once)')));
});

test('Debug Logging: MessageHandler logs incoming messages, parsing, and policy checks in debug mode', async () => {
  const debugLogs = [];
  const fakeLogger = {
    debug: (msg) => debugLogs.push(typeof msg === 'function' ? msg() : msg),
    info: () => {},
    warn: () => {},
    error: () => {},
    command: () => {},
  };

  const fakeGroups = {
    hasGroup: () => true,
    isEnabled: () => true,
    privateOnly: false,
    groups: () => [['1203630test@g.us', 'Test Group']],
    rememberGroup: async () => {},
  };

  const executedCommands = [];
  const mockCommand = {
    name: 'ping',
    ownerOnly: false,
    execute: async (ctx, args) => executedCommands.push({ name: 'ping', args }),
  };

  const handler = new MessageHandler({
    registry: { resolve: (name) => (name === 'ping' ? mockCommand : null) },
    parser: {
      parse: (text) => {
        if (!text || !text.startsWith('.')) return null;
        const [name, ...rest] = text.slice(1).split(/\s+/);
        return { prefix: '.', name, args: rest.join(' ') };
      },
    },
    logger: fakeLogger,
    config: { messageConcurrency: 5, maxInputBytes: 1024 * 1024, staleMessageSeconds: 120 },
    groups: fakeGroups,
    owners: { isOwner: () => false },
    viewOnceCache: { remember: () => {} },
  });

  const fakeSock = {
    user: { id: '628bot@s.whatsapp.net' },
    sendMessage: async () => ({ key: { id: 'ack' } }),
    sendPresenceUpdate: async () => {},
  };

  // Case 1: Regular chat message (not a command)
  const regularMsg = {
    key: { remoteJid: 'user@s.whatsapp.net', id: 'm1', fromMe: false },
    message: { conversation: 'selamat pagi kawan' },
  };
  handler.handle(fakeSock, { type: 'notify', messages: [regularMsg] });
  await new Promise((r) => setTimeout(r, 60));

  assert.ok(debugLogs.some((l) => l.includes('Pesan masuk dari') && l.includes('selamat pagi kawan')));
  assert.ok(debugLogs.some((l) => l.includes('Pengecekan kebijakan')));
  assert.ok(debugLogs.some((l) => l.includes('Bukan command')));

  // Case 2: Recognized command
  debugLogs.length = 0;
  const cmdMsg = {
    key: { remoteJid: 'user@s.whatsapp.net', id: 'm2', fromMe: false },
    message: { conversation: '.ping 123' },
  };
  handler.handle(fakeSock, { type: 'notify', messages: [cmdMsg] });
  await new Promise((r) => setTimeout(r, 60));

  assert.ok(debugLogs.some((l) => l.includes('Command dikenali: ".ping"')));
  assert.ok(debugLogs.some((l) => l.includes('Otorisasi: command "ping" bersifat publik')));
  assert.equal(executedCommands.length, 1);

  // Case 3: Unrecognized command
  debugLogs.length = 0;
  const unknownCmdMsg = {
    key: { remoteJid: 'user@s.whatsapp.net', id: 'm3', fromMe: false },
    message: { conversation: '.foo bar' },
  };
  handler.handle(fakeSock, { type: 'notify', messages: [unknownCmdMsg] });
  await new Promise((r) => setTimeout(r, 60));

  assert.ok(debugLogs.some((l) => l.includes('Command tidak dikenal: ".foo"')));

  // Case 4: Non-notify upsert (append)
  debugLogs.length = 0;
  handler.handle(fakeSock, { type: 'append', messages: [regularMsg] });
  assert.ok(debugLogs.some((l) => l.includes('messages.upsert dilewati: type=append (bukan notify)')));
});

test('Debug Logging: MediaDownloader, MediaConverter, StickerCommand, AvoCommand debug logs', async () => {
  const debugLogs = [];
  const fakeLogger = {
    debug: (msg) => debugLogs.push(typeof msg === 'function' ? msg() : msg),
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  // 1. MediaConverter
  const fakeFfmpeg = {
    run: async () => {},
  };
  const converter = new MediaConverter({ ffmpeg: fakeFfmpeg, logger: fakeLogger });
  await converter.videoToAnimatedWebp('in.mp4', 'out.webp', { size: 512, maxSeconds: 7, fps: 15, quality: 60 });
  assert.ok(debugLogs.some((l) => l.includes('video -> animated WebP')));

  await converter.webpToMp4('in.webp', 'out.mp4');
  assert.ok(debugLogs.some((l) => l.includes('static WebP -> MP4')));

  // 2. StickerCommand
  debugLogs.length = 0;
  const fakeFactory = {
    fromImage: async () => Buffer.from('fake-sticker'),
  };
  const stickerCmd = new StickerCommand({
    stickerFactory: fakeFactory,
    metaParser: { parse: () => ({ pack: 'test', author: 'bot', custom: false }) },
    maxSeconds: 7,
    prefix: '.',
    logger: fakeLogger,
  });

  let stickerSent = false;
  const fakeCtx = {
    senderLabel: 'User (628123)',
    pushName: 'User',
    findMedia: () => ({ type: 'imageMessage', node: {} }),
    download: async () => Buffer.from('fake-img'),
    sendSticker: async () => {
      stickerSent = true;
    },
    react: async () => {},
    reply: async () => {},
  };

  await stickerCmd.execute(fakeCtx, '');
  assert.equal(stickerSent, true);
  assert.ok(debugLogs.some((l) => l.includes('StickerCommand: memproses media')));
  assert.ok(debugLogs.some((l) => l.includes('StickerCommand: unduhan media selesai')));
  assert.ok(debugLogs.some((l) => l.includes('StickerCommand: pembuatan sticker selesai')));

  // 3. AvoCommand
  debugLogs.length = 0;
  let resendCalled = false;
  const avoCmd = new AvoCommand({
    cache: null,
    prefix: '.',
    ownerOnly: false,
    logger: fakeLogger,
  });
  const voCtx = {
    senderLabel: 'User (628123)',
    chatLabel: 'Private',
    findMedia: () => ({ type: 'imageMessage', node: { caption: 'secret' }, viewOnce: true }),
    download: async () => Buffer.from('fake-vo-bytes'),
    sendImage: async () => {
      resendCalled = true;
    },
    react: async () => {},
  };

  await avoCmd.execute(voCtx, '');
  assert.equal(resendCalled, true);
  assert.ok(debugLogs.some((l) => l.includes('AvoCommand: dieksekusi')));
  assert.ok(debugLogs.some((l) => l.includes('AvoCommand: mengunduh media view-once')));
  assert.ok(debugLogs.some((l) => l.includes('AvoCommand: unduhan media selesai')));
  assert.ok(debugLogs.some((l) => l.includes('AvoCommand: media view-once sukses dikirim')));
});

test('Debug Logging: GetPpCommand, PingCommand, BotCommand, and MediaDownloader edge cases', async () => {
  const debugLogs = [];
  const fakeLogger = {
    debug: (msg) => debugLogs.push(typeof msg === 'function' ? msg() : msg),
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  // 1. MediaDownloader with null sock handles oversized media safely
  const downloader = new MediaDownloader({ sock: null, maxInputBytes: 1024, logger: fakeLogger });
  await assert.rejects(
    () => downloader.download({ node: { fileLength: 5000 }, type: 'imageMessage' }),
    /File terlalu besar/,
  );
  assert.ok(debugLogs.some((l) => l.includes('MediaDownloader: unduhan ditolak')));

  // 2. GetPpCommand debug logs
  debugLogs.length = 0;
  const getPpCmd = new GetPpCommand({ logger: fakeLogger });
  // Case A: Missing mention
  await assert.rejects(() => getPpCmd.execute({ mentionedJids: [] }), /Mention user/);
  assert.ok(debugLogs.some((l) => l.includes('GetPpCommand: tidak ada mention user')));

  // Case B: Successful profile picture fetch
  debugLogs.length = 0;
  let sentPpImage = false;
  const ppCtx = {
    mentionedJids: ['628123456@s.whatsapp.net'],
    profilePicture: async () => Buffer.from('fake-avatar-bytes'),
    sendImage: async () => {
      sentPpImage = true;
    },
  };
  await getPpCmd.execute(ppCtx);
  assert.equal(sentPpImage, true);
  assert.ok(debugLogs.some((l) => l.includes('GetPpCommand: mengambil foto profil untuk mention=628123456@s.whatsapp.net')));
  assert.ok(debugLogs.some((l) => l.includes('GetPpCommand: foto profil berhasil didapatkan')));

  // 3. PingCommand debug logs
  debugLogs.length = 0;
  let edited = false;
  const pingCmd = new PingCommand({
    system: { snapshot: async () => ({ hostname: 'testhost' }) },
    provider: { lookup: async () => ({ ip: '1.1.1.1' }) },
    formatter: { format: () => 'formatted ping report' },
    logger: fakeLogger,
  });
  const pingCtx = {
    senderLabel: 'Tester (6281)',
    reply: async () => ({ key: { id: 'k1' } }),
    edit: async () => {
      edited = true;
    },
  };
  await pingCmd.execute(pingCtx);
  assert.equal(edited, true);
  assert.ok(debugLogs.some((l) => l.includes('PingCommand: dieksekusi oleh Tester (6281)')));
  assert.ok(debugLogs.some((l) => l.includes('PingCommand: mengumpulkan snapshot sistem')));
  assert.ok(debugLogs.some((l) => l.includes('PingCommand: laporan siap')));

  // 4. BotCommand debug logs
  debugLogs.length = 0;
  let privateOnlySet = null;
  const fakeGroups = {
    setPrivateOnly: async (val) => {
      privateOnlySet = val;
    },
    privateOnly: false,
    defaultEnabled: true,
    groups: () => [],
  };
  const botCmd = new BotCommand({
    groups: fakeGroups,
    prefix: '.',
    logger: fakeLogger,
  });
  const botCtx = {
    senderLabel: 'Owner (628000)',
    react: async () => {},
    reply: async () => {},
  };
  await botCmd.execute(botCtx, 'off');
  assert.equal(privateOnlySet, true);
  assert.ok(debugLogs.some((l) => l.includes('BotCommand: aksi "off" dieksekusi oleh Owner (628000)')));
});
