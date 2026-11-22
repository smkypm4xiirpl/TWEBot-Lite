import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { SmemeCommand } from '../src/commands/SmemeCommand.js';
import { BratCommand } from '../src/commands/BratCommand.js';
import { ImageService } from '../src/services/ImageService.js';
import { StickerExifService } from '../src/services/StickerExifService.js';
import { CommandRegistry } from '../src/core/CommandRegistry.js';
import {
  escapeXml,
  wrapWords,
  fitMemeLines,
  buildMemeSvg,
  fitBratLines,
  buildBratSvg,
} from '../src/utils/textSvgGenerator.js';

// --- Helper Fake Context Builder ---
function createFakeCtx({ text = '', media = null, pushName = 'Tester', fromMe = false } = {}) {
  const reactions = [];
  let replyText = null;
  let sentSticker = null;

  return {
    pushName,
    senderLabel: '6281234567890',
    identityUsers: ['6281234567890'],
    fromMe,
    findMedia: (types) => {
      if (media && types.includes(media.type)) return media;
      return null;
    },
    download: async (_media) => {
      return media?.buffer ?? Buffer.from('fake-buffer');
    },
    react: async (emoji) => {
      reactions.push(emoji);
    },
    reply: async (msg) => {
      replyText = msg;
      return { key: { id: 'msg-id' } };
    },
    sendSticker: async (buf) => {
      sentSticker = buf;
      return { key: { id: 'sticker-id' } };
    },
    get reactions() {
      return reactions;
    },
    get replyText() {
      return replyText;
    },
    get sentSticker() {
      return sentSticker;
    },
  };
}

// -------------------------------------------------------------
// 1. Text SVG Generator Unit Tests
// -------------------------------------------------------------

test('TextSvgGenerator: escapeXml handles all special characters and boundary values', () => {
  assert.equal(escapeXml('Tom & Jerry <cartoon> "funny" \'quote\''), 'Tom &amp; Jerry &lt;cartoon&gt; &quot;funny&quot; &apos;quote&apos;');
  assert.equal(escapeXml(''), '');
  assert.equal(escapeXml(null), '');
  assert.equal(escapeXml(undefined), '');
  assert.equal(escapeXml(12345), '12345');
});

test('TextSvgGenerator: wrapWords wraps correctly and splits oversized words', () => {
  const wrapped = wrapWords('Halo dunia yang indah dan luar biasa', 12);
  assert.deepEqual(wrapped, ['Halo dunia', 'yang indah', 'dan luar', 'biasa']);

  // Oversized word split
  const oversized = wrapWords('SUPERLONGWORDEXCEEDINGMAXIMUMCHARS Halo', 10);
  assert.equal(oversized[0], 'SUPERLONGW');
  assert.equal(oversized[1], 'ORDEXCEEDI');
  assert.equal(oversized[2], 'NGMAXIMUMC');
  assert.equal(oversized[3], 'HARS');
  assert.equal(oversized[4], 'Halo');

  // Empty string
  assert.deepEqual(wrapWords('   ', 15), []);
});

test('TextSvgGenerator: fitMemeLines scales font size based on text length', () => {
  const shortText = fitMemeLines('SHORT TEXT', 460);
  assert.equal(shortText.fontSize, 46);
  assert.equal(shortText.lines.length, 1);

  const longText = fitMemeLines('KATA PERTAMA KEDUA KETIGA KEEMPAT KELIMA KEENAM KETUJUH KEDELAPAN KESEMBILAN KESEPULUH', 460);
  assert.ok(longText.fontSize < 46);
  assert.ok(longText.lines.length <= 4);

  const emptyText = fitMemeLines('', 460);
  assert.deepEqual(emptyText.lines, []);
});

test('TextSvgGenerator: buildMemeSvg generates valid SVG with stroke and fill layers', () => {
  const svgBoth = buildMemeSvg({
    topText: 'ATAS <MEME>',
    bottomText: 'BAWAH & SERU',
    origWidth: 800,
    origHeight: 600,
    size: 512,
  });

  assert.ok(svgBoth.startsWith('<svg width="512" height="512"'));
  assert.ok(svgBoth.includes('&lt;MEME&gt;'));
  assert.ok(svgBoth.includes('&amp; SERU'));
  assert.ok(svgBoth.includes('stroke="#000000"'));
  assert.ok(svgBoth.includes('fill="#FFFFFF"'));
  assert.ok(svgBoth.includes('font-family="Impact, Arial Black, sans-serif"'));

  // Top only
  const svgTopOnly = buildMemeSvg({ topText: 'HANYA ATAS', bottomText: '' });
  assert.ok(svgTopOnly.includes('HANYA ATAS'));

  // Bottom only
  const svgBottomOnly = buildMemeSvg({ topText: '', bottomText: 'HANYA BAWAH' });
  assert.ok(svgBottomOnly.includes('HANYA BAWAH'));
});

test('TextSvgGenerator: fitBratLines lowercases and chooses appropriate scale', () => {
  const short = fitBratLines('BRAT');
  assert.equal(short.lines[0], 'brat');
  assert.equal(short.fontSize, 96);

  const medium = fitBratLines('So Julia and Apple');
  assert.ok(medium.fontSize < 96);
  assert.ok(medium.lines.every((l) => l === l.toLowerCase()));

  const fallback = fitBratLines('');
  assert.equal(fallback.lines[0], 'brat');
});

test('TextSvgGenerator: buildBratSvg supports default lime green and white deluxe edition', () => {
  const greenSvg = buildBratSvg({ text: 'apple', isWhite: false, size: 512 });
  assert.ok(greenSvg.includes('fill="#8ACE00"'));
  assert.ok(greenSvg.includes('feGaussianBlur'));
  assert.ok(greenSvg.includes('apple'));

  const whiteSvg = buildBratSvg({ text: 'talk talk', isWhite: true, size: 512 });
  assert.ok(whiteSvg.includes('fill="#FFFFFF"'));
  assert.ok(whiteSvg.includes('talk talk'));
});

// -------------------------------------------------------------
// 2. SmemeCommand Unit Tests
// -------------------------------------------------------------

test('SmemeCommand: metadata, name, and aliases', () => {
  const cmd = new SmemeCommand();
  assert.equal(cmd.name, 'smeme');
  assert.deepEqual(cmd.aliases, ['stickermeme', 'sm']);
  assert.equal(cmd.ownerOnly, false);
});

test('SmemeCommand: CommandRegistry resolves all aliases', () => {
  const registry = new CommandRegistry();
  const cmd = new SmemeCommand();
  registry.register(cmd);

  assert.equal(registry.resolve('smeme'), cmd);
  assert.equal(registry.resolve('stickermeme'), cmd);
  assert.equal(registry.resolve('sm'), cmd);
});

test('SmemeCommand: shows aesthetic guide when invoked without media or without text', async () => {
  const cmd = new SmemeCommand({ prefix: '.' });

  // 1. No media, no text
  const ctx1 = createFakeCtx({ text: '' });
  await cmd.execute(ctx1, '');
  assert.equal(ctx1.reactions[0], '❓');
  assert.ok(ctx1.replyText.includes('SMART MEME STICKER'));
  assert.ok(ctx1.replyText.includes('.smeme Teks Atas | Teks Bawah'));
  assert.equal(ctx1.sentSticker, null);

  // 2. Has media, but empty text
  const fakeMedia = { type: 'imageMessage', node: {} };
  const ctx2 = createFakeCtx({ text: '', media: fakeMedia });
  await cmd.execute(ctx2, '   ');
  assert.equal(ctx2.reactions[0], '❓');
  assert.ok(ctx2.replyText.includes('SMART MEME STICKER'));
  assert.equal(ctx2.sentSticker, null);

  // 3. Has text, but no media
  const ctx3 = createFakeCtx({ text: 'halo | dunia' });
  await cmd.execute(ctx3, 'halo | dunia');
  assert.equal(ctx3.reactions[0], '❓');
  assert.ok(ctx3.replyText.includes('SMART MEME STICKER'));
  assert.equal(ctx3.sentSticker, null);

  // 4. Help argument
  const ctx4 = createFakeCtx({ text: 'help', media: fakeMedia });
  await cmd.execute(ctx4, 'help');
  assert.equal(ctx4.reactions[0], '❓');
  assert.ok(ctx4.replyText.includes('SMART MEME STICKER'));
});

test('SmemeCommand: creates meme with top and bottom text separated by |', async () => {
  let memeCalledWith = null;
  let exifCalledWith = null;

  const fakeImages = {
    createMeme: async (buf, opts) => {
      memeCalledWith = { buf, opts };
      return Buffer.from('fake-meme-webp');
    },
  };

  const fakeExif = {
    embed: async (buf, meta) => {
      exifCalledWith = { buf, meta };
      return Buffer.from('fake-exif-sticker');
    },
  };

  const stickerConfig = {
    defaultPack: 'MyBot Pack',
    defaultAuthor: 'MyBot Author',
    size: 512,
    imageQuality: 82,
  };

  const cmd = new SmemeCommand({
    images: fakeImages,
    exif: fakeExif,
    prefix: '.',
    stickerConfig,
  });

  const sampleBuffer = Buffer.from('image-bytes');
  const fakeMedia = { type: 'imageMessage', node: {}, buffer: sampleBuffer };
  const ctx = createFakeCtx({ media: fakeMedia, pushName: 'Budi' });

  await cmd.execute(ctx, 'Ketika Coding | Ada Bug Misterius');

  assert.deepEqual(ctx.reactions, ['⏳', '✅']);
  assert.equal(memeCalledWith.buf, sampleBuffer);
  assert.equal(memeCalledWith.opts.topText, 'Ketika Coding');
  assert.equal(memeCalledWith.opts.bottomText, 'Ada Bug Misterius');
  assert.equal(memeCalledWith.opts.size, 512);
  assert.equal(memeCalledWith.opts.quality, 82);

  assert.equal(exifCalledWith.meta.pack, 'MyBot Pack');
  assert.equal(exifCalledWith.meta.author, 'MyBot Author');
  assert.equal(ctx.sentSticker.toString(), 'fake-exif-sticker');
});

test('SmemeCommand: defaults single text to bottom punchline text', async () => {
  let memeCalledWith = null;

  const fakeImages = {
    createMeme: async (buf, opts) => {
      memeCalledWith = opts;
      return Buffer.from('fake-meme-webp');
    },
  };

  const fakeExif = {
    embed: async (buf) => buf,
  };

  const cmd = new SmemeCommand({
    images: fakeImages,
    exif: fakeExif,
    stickerConfig: { defaultPack: 'Pack' },
  });

  const fakeMedia = { type: 'stickerMessage', node: { isAnimated: true }, buffer: Buffer.from('sticker') };
  const ctx = createFakeCtx({ media: fakeMedia });

  await cmd.execute(ctx, 'Santai dulu gak sih');

  assert.equal(memeCalledWith.topText, '');
  assert.equal(memeCalledWith.bottomText, 'Santai dulu gak sih');
});

test('SmemeCommand: respects single top text when followed by pipe', async () => {
  let memeCalledWith = null;

  const fakeImages = {
    createMeme: async (buf, opts) => {
      memeCalledWith = opts;
      return Buffer.from('fake-meme-webp');
    },
  };

  const fakeExif = {
    embed: async (buf) => buf,
  };

  const cmd = new SmemeCommand({
    images: fakeImages,
    exif: fakeExif,
    stickerConfig: { defaultPack: 'Pack' },
  });

  const fakeMedia = { type: 'imageMessage', node: {}, buffer: Buffer.from('img') };
  const ctx = createFakeCtx({ media: fakeMedia });

  await cmd.execute(ctx, 'Teks Atas Saja |');

  assert.equal(memeCalledWith.topText, 'Teks Atas Saja');
  assert.equal(memeCalledWith.bottomText, '');
});

// -------------------------------------------------------------
// 3. BratCommand Unit Tests
// -------------------------------------------------------------

test('BratCommand: metadata, name, and aliases', () => {
  const cmd = new BratCommand();
  assert.equal(cmd.name, 'brat');
  assert.deepEqual(cmd.aliases, ['bratgenerator']);
  assert.equal(cmd.ownerOnly, false);
});

test('BratCommand: CommandRegistry resolves brat and bratgenerator', () => {
  const registry = new CommandRegistry();
  const cmd = new BratCommand();
  registry.register(cmd);

  assert.equal(registry.resolve('brat'), cmd);
  assert.equal(registry.resolve('bratgenerator'), cmd);
});

test('BratCommand: shows aesthetic guide when text is missing or help requested', async () => {
  const cmd = new BratCommand({ prefix: '.' });

  // 1. Empty args
  const ctx1 = createFakeCtx();
  await cmd.execute(ctx1, '');
  assert.equal(ctx1.reactions[0], '❓');
  assert.ok(ctx1.replyText.includes('VIRAL BRAT STICKER GENERATOR'));
  assert.ok(ctx1.replyText.includes('.brat <teks>'));

  // 2. Only flag with no text
  const ctx2 = createFakeCtx();
  await cmd.execute(ctx2, '-w');
  assert.equal(ctx2.reactions[0], '❓');
  assert.ok(ctx2.replyText.includes('VIRAL BRAT STICKER GENERATOR'));

  // 3. Help argument
  const ctx3 = createFakeCtx();
  await cmd.execute(ctx3, 'help');
  assert.equal(ctx3.reactions[0], '❓');
  assert.ok(ctx3.replyText.includes('VIRAL BRAT STICKER GENERATOR'));
});

test('BratCommand: generates standard green brat sticker', async () => {
  let bratCalledWith = null;
  let exifCalledWith = null;

  const fakeImages = {
    createBrat: async (text, opts) => {
      bratCalledWith = { text, opts };
      return Buffer.from('fake-brat-webp');
    },
  };

  const fakeExif = {
    embed: async (buf, meta) => {
      exifCalledWith = { buf, meta };
      return Buffer.from('fake-brat-sticker');
    },
  };

  const cmd = new BratCommand({
    images: fakeImages,
    exif: fakeExif,
    prefix: '.',
    stickerConfig: { defaultPack: 'Brat Pack', defaultAuthor: 'Brat Author' },
  });

  const ctx = createFakeCtx({ pushName: 'Charli' });
  await cmd.execute(ctx, 'so julia');

  assert.deepEqual(ctx.reactions, ['⏳', '✅']);
  assert.equal(bratCalledWith.text, 'so julia');
  assert.equal(bratCalledWith.opts.isWhite, false);
  assert.equal(exifCalledWith.meta.pack, 'Brat Pack');
  assert.equal(exifCalledWith.meta.author, 'Brat Author');
  assert.equal(ctx.sentSticker.toString(), 'fake-brat-sticker');
});

test('BratCommand: generates white deluxe edition sticker via -w or --white flag', async () => {
  let bratCalledWith = null;

  const fakeImages = {
    createBrat: async (text, opts) => {
      bratCalledWith = { text, opts };
      return Buffer.from('fake-brat-webp');
    },
  };

  const fakeExif = {
    embed: async (buf) => buf,
  };

  const cmd = new BratCommand({
    images: fakeImages,
    exif: fakeExif,
  });

  // Flag at start: -w
  const ctx1 = createFakeCtx();
  await cmd.execute(ctx1, '-w kamu nanya');
  assert.equal(bratCalledWith.opts.isWhite, true);
  assert.equal(bratCalledWith.text, 'kamu nanya');

  // Flag at start: --white
  const ctx2 = createFakeCtx();
  await cmd.execute(ctx2, '--white kamu nanya');
  assert.equal(bratCalledWith.opts.isWhite, true);
  assert.equal(bratCalledWith.text, 'kamu nanya');

  // Flag at end: -w
  const ctx3 = createFakeCtx();
  await cmd.execute(ctx3, 'cape banget -w');
  assert.equal(bratCalledWith.opts.isWhite, true);
  assert.equal(bratCalledWith.text, 'cape banget');
});

// -------------------------------------------------------------
// 4. Real Sharp End-to-End ImageService Integration Tests
// -------------------------------------------------------------

test('ImageService: real createMeme generates valid 512x512 WebP sticker', async () => {
  const images = new ImageService();
  const exif = new StickerExifService();

  // Create a 200x200 red test image
  const samplePng = await sharp({
    create: {
      width: 200,
      height: 200,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const webpBuffer = await images.createMeme(samplePng, {
    topText: 'TOP MEME',
    bottomText: 'BOTTOM MEME',
    size: 512,
    quality: 80,
  });

  assert.ok(Buffer.isBuffer(webpBuffer));
  assert.ok(webpBuffer.length > 0);

  // Validate WebP format via sharp metadata
  const meta = await sharp(webpBuffer).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);

  // Embed EXIF and verify it succeeds
  const sticker = await exif.embed(webpBuffer, { pack: 'Test Pack', author: 'Test Author' });
  assert.ok(Buffer.isBuffer(sticker));
  assert.ok(sticker.length > webpBuffer.length);
});

test('ImageService: real createBrat generates valid 512x512 WebP sticker in under 100ms', async () => {
  const images = new ImageService();
  const exif = new StickerExifService();

  const start = performance.now();
  const webpBuffer = await images.createBrat('brat', {
    isWhite: false,
    size: 512,
    quality: 85,
  });
  const duration = performance.now() - start;

  assert.ok(Buffer.isBuffer(webpBuffer));
  assert.ok(webpBuffer.length > 0);

  const meta = await sharp(webpBuffer).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);

  const sticker = await exif.embed(webpBuffer, { pack: 'Brat Pack', author: 'Brat' });
  assert.ok(Buffer.isBuffer(sticker));
  assert.ok(sticker.length > webpBuffer.length);
});
