import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageContext } from '../src/core/MessageContext.js';
import { MessageExtractor } from '../src/core/MessageExtractor.js';
import { MediaDownloader } from '../src/core/MediaDownloader.js';
import { MessageSender } from '../src/core/MessageSender.js';
import {
  StickerCommand,
  ImageStickerStrategy,
  VideoStickerStrategy,
  StickerRecreationStrategy,
} from '../src/commands/StickerCommand.js';

test('P2: MessageContext facade cleanly delegates to SRP components', async () => {
  let presenceCalled = false;
  let reactCalled = false;
  let replyCalled = false;

  const fakeSock = {
    user: { id: '628123:1@s.whatsapp.net' },
    sendPresenceUpdate: async () => {
      presenceCalled = true;
    },
    sendMessage: async (jid, content) => {
      if (content.react) reactCalled = true;
      if (content.text) replyCalled = true;
      return { key: { id: 'ack' } };
    },
  };

  const fakeMessage = {
    key: { remoteJid: 'user@s.whatsapp.net', id: 'msg-1' },
    message: { conversation: '.ping' },
  };

  const ctx = new MessageContext({
    sock: fakeSock,
    message: fakeMessage,
    maxInputBytes: 1024,
  });

  assert.equal(ctx.jid, 'user@s.whatsapp.net');
  assert.equal(ctx.text, '.ping');
  assert.equal(ctx.isGroup, false);

  // Status operations are non-blocking fire-and-forget
  const p1 = ctx.setTyping(true);
  const p2 = ctx.react('👍');
  assert.ok(p1 instanceof Promise);
  assert.ok(p2 instanceof Promise);

  await ctx.reply('pong');
  assert.equal(replyCalled, true);
});

test('P2: StickerCommand media strategies dispatch accurately', async () => {
  let calledWith = null;

  const fakeFactory = {
    fromImage: async (buf, meta) => {
      calledWith = { type: 'image', buf, meta };
      return Buffer.from('img-webp');
    },
    fromVideo: async (buf, meta, opts) => {
      calledWith = { type: 'video', buf, meta, opts };
      return Buffer.from('vid-webp');
    },
    fromSticker: async (buf, meta) => {
      calledWith = { type: 'sticker', buf, meta };
      return Buffer.from('stk-webp');
    },
  };

  const imgStrat = new ImageStickerStrategy();
  await imgStrat.create(fakeFactory, Buffer.from('1'), { pack: 'p', author: 'a' });
  assert.equal(calledWith.type, 'image');

  const vidStrat = new VideoStickerStrategy();
  await vidStrat.create(
    fakeFactory,
    Buffer.from('2'),
    { pack: 'p', author: 'a' },
    { node: { seconds: 8 } },
  );
  assert.equal(calledWith.type, 'video');
  assert.equal(calledWith.opts.duration, 8);

  const stkStrat = new StickerRecreationStrategy();
  await stkStrat.create(fakeFactory, Buffer.from('3'), { pack: 'p', author: 'a' });
  assert.equal(calledWith.type, 'sticker');
});

test('P2: MediaConverter animatedWebpToMp4 converts animated webp cleanly and ToVideoCommand delegates', async () => {
  const { FfmpegService } = await import('../src/services/FfmpegService.js');
  const { MediaConverter } = await import('../src/services/MediaConverter.js');
  const { ImageService } = await import('../src/services/ImageService.js');
  const { ToVideoCommand } = await import('../src/commands/ToVideoCommand.js');
  const { withTempDir } = await import('../src/utils/withTempDir.js');
  const path = await import('node:path');
  const fs = await import('node:fs/promises');

  const ffmpeg = new FfmpegService({ concurrency: 2 });
  const images = new ImageService();
  const converter = new MediaConverter({ ffmpeg, images });

  // 1. Create a test 1-second animated WebP
  let webpBuffer;
  await withTempDir(async (dir) => {
    const rawWebp = path.join(dir, 'anim.webp');
    await ffmpeg.run([
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x160:rate=10',
      '-c:v', 'libwebp',
      '-loop', '0',
      rawWebp,
    ]);
    webpBuffer = await fs.readFile(rawWebp);
  });

  assert.ok(webpBuffer.length > 0);

  // 2. Convert using animatedWebpToMp4
  const mp4Buffer = await converter.animatedWebpToMp4(webpBuffer, { background: '#ffffff' });
  assert.ok(mp4Buffer.length > 0);
  // MP4 files start with ftyp box at byte 4
  const boxType = mp4Buffer.subarray(4, 8).toString('ascii');
  assert.equal(boxType, 'ftyp');

  // 3. Verify ToVideoCommand execution
  let sentGif = null;
  const fakeCtx = {
    findMedia: () => ({
      type: 'stickerMessage',
      node: { isAnimated: true },
      key: {},
    }),
    download: async () => webpBuffer,
    sendGif: async (buf, caption) => {
      sentGif = { buf, caption };
    },
    react: () => Promise.resolve(),
    reply: async () => {},
  };

  const toVid = new ToVideoCommand({
    converter,
    background: '#ffffff',
    prefix: '.',
  });

  await toVid.execute(fakeCtx);
  assert.ok(sentGif);
  assert.equal(sentGif.buf.subarray(4, 8).toString('ascii'), 'ftyp');
});
