import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { BotClient } from './core/BotClient.js';

import { CommandParser } from './core/CommandParser.js';
import { CommandRegistry } from './core/CommandRegistry.js';

import { Logger } from './core/Logger.js';
import { MessageHandler } from './core/MessageHandler.js';

import { OwnerPolicy } from './core/OwnerPolicy.js';
import { PairingAuthenticator } from './core/PairingAuthenticator.js';

import { AvoCommand } from './commands/AvoCommand.js';
import { BotCommand } from './commands/BotCommand.js';
import { BratCommand } from './commands/BratCommand.js';
import { CloseGcCommand } from './commands/CloseGcCommand.js';
import { GetPpCommand } from './commands/GetPpCommand.js';
import { MenuCommand } from './commands/MenuCommand.js';
import { OpenGcCommand } from './commands/OpenGcCommand.js';
import { PingCommand } from './commands/PingCommand.js';
import { SmemeCommand } from './commands/SmemeCommand.js';
import { StickerCommand } from './commands/StickerCommand.js';
import { ToImageCommand } from './commands/ToImageCommand.js';
import { ToVideoCommand } from './commands/ToVideoCommand.js';

import { config } from './config.js';

import { FfmpegService } from './services/FfmpegService.js';
import { GroupSettings } from './services/GroupSettings.js';
import { ImageService } from './services/ImageService.js';

import { JsonStore } from './services/JsonStore.js';

import { MediaConverter } from './services/MediaConverter.js';
import { PingReportFormatter } from './services/PingReportFormatter.js';

import { ProviderInfoService } from './services/ProviderInfoService.js';
import { StickerExifService } from './services/StickerExifService.js';

import { StickerFactory } from './services/StickerFactory.js';

import { SystemInfoService } from './services/SystemInfoService.js';

import { ViewOnceCache } from './services/ViewOnceCache.js';
import { ViewOnceForwarder } from './services/ViewOnceForwarder.js';
import { StickerMetaParser } from './utils/StickerMetaParser.js';

/** Composition root: satu-satunya tempat dependency dirangkai. */
async function buildApplication(logger) {
  const prefix = config.prefixes[0];
  const { sticker } = config;

  const ffmpeg = new FfmpegService({ binaryPath: config.ffmpegPath, concurrency: config.ffmpegConcurrency });
  const images = new ImageService();
  const exif = new StickerExifService();
  const converter = new MediaConverter({ ffmpeg, images, logger: logger.child('media') });
  const stickerFactory = new StickerFactory({
    converter,
    images,
    exif,
    options: sticker,
    logger: logger.child('sticker'),
  });
  const metaParser = new StickerMetaParser({
    defaultPack: sticker.defaultPack,
    defaultAuthor: sticker.defaultAuthor,
    maxLength: sticker.maxMetaLength,
  });

  await mkdir(config.dataDir, { recursive: true }).catch(() => {});

  const groups = new GroupSettings({
    store: new JsonStore(path.join(config.dataDir, 'groups.json'), { logger: logger.child('store') }),
    defaultEnabled: config.groupDefaultEnabled,
  });
  await groups.init();

  const owners = new OwnerPolicy(config.owners);
  const viewOnceCache = new ViewOnceCache(config.viewOnceCache);
  const viewOnceStore = new JsonStore(path.join(config.dataDir, 'antiviewonce.json'), {
    logger: logger.child('store'),
  });
  const viewOnceForwarder = new ViewOnceForwarder({
    store: viewOnceStore,
    logger: logger.child('avo-forward'),
    groups,
    defaultTarget: config.avoForwardGroup,
  });
  await viewOnceForwarder.init();

  const systemInfo = new SystemInfoService({ cpuSampleMs: config.ping.cpuSampleMs });
  const providerInfo = new ProviderInfoService({ cacheMs: config.ping.ipCacheMs, timeoutMs: config.ping.ipTimeoutMs });
  providerInfo.prewarm();

  const registry = new CommandRegistry()
    .register(
      new StickerCommand({
        stickerFactory,
        metaParser,
        maxSeconds: sticker.maxSeconds,
        prefix,
        logger: logger.child('cmd:sticker'),
      }),
    )
    .register(
      new SmemeCommand({
        images,
        exif,
        prefix,
        stickerConfig: sticker,
        logger: logger.child('cmd:smeme'),
      }),
    )
    .register(
      new BratCommand({
        images,
        exif,
        prefix,
        stickerConfig: sticker,
        logger: logger.child('cmd:brat'),
      }),
    )
    .register(new ToImageCommand({ images, prefix, logger: logger.child('cmd:toimg') }))
    .register(
      new ToVideoCommand({
        converter,
        background: config.video.background,
        prefix,
        logger: logger.child('cmd:tovid'),
      }),
    )
    .register(
      new AvoCommand({
        cache: viewOnceCache,
        prefix,
        ownerOnly: config.avoOwnerOnly,
        forwarder: viewOnceForwarder,
        owners,
        groups,
        logger: logger.child('cmd:avo'),
      }),
    )
    .register(new GetPpCommand({ logger: logger.child('cmd:getpp') }))
    .register(
      new PingCommand({
        system: systemInfo,
        provider: providerInfo,
        formatter: new PingReportFormatter(),
        logger: logger.child('cmd:ping'),
      }),
    )
    .register(new BotCommand({ groups, prefix, logger: logger.child('cmd:bot') }))
    .register(new CloseGcCommand({ owners, logger: logger.child('cmd:closegc') }))
    .register(new OpenGcCommand({ owners, logger: logger.child('cmd:opengc') }))
    .register(
      new MenuCommand({
        botName: config.botName,
        prefix,
        owners,
        logger: logger.child('cmd:menu'),
      }),
    );

  logger.info(`Command terdaftar: ${registry.all().length} (${registry.all().map((c) => c.name).join(', ')})`);

  const messageHandler = new MessageHandler({
    registry,
    parser: new CommandParser(config.prefixes),
    logger: logger.child('handler'),
    config,
    groups,
    owners,
    viewOnceCache,
    forwarder: viewOnceForwarder,
  });

  const waLogger = logger.child('wa');
  const pairing = new PairingAuthenticator({
    logger: waLogger,
    phoneNumber: config.pairingNumber,
    customCode: config.pairingCode,
  });

  return { ffmpeg, owners, bot: new BotClient({ config, logger: waLogger, messageHandler, pairing }), systemInfo, groups };
}

async function main() {
  const logger = new Logger('app');
  Logger.banner({ name: config.botName, prefixes: config.prefixes, node: process.versions.node });

  const { ffmpeg, owners, bot, systemInfo, groups } = await buildApplication(logger);
  logger.success(`FFmpeg siap (v${await ffmpeg.version()})`);

  if (owners.configuredCount === 0) {
    logger.warn('OWNER_NUMBERS kosong: hanya akun bot sendiri yang dianggap owner (command owner-only).');
  } else {
    logger.info(`Owner terdaftar: ${owners.configuredCount} nomor/ID`);
  }

  if (logger.isDebugEnabled) {
    logger.debug('Mode debug aktif (LOG_LEVEL=debug). Log rinci pesan & pemrosesan media diaktifkan.');
  }

  const shutdown = (signal) => {
    logger.info(`${signal} diterima, mematikan bot...`);
    systemInfo.stop();
    bot.stop();
    // Pastikan buffer log ter-flush sebelum proses keluar.
    Logger.shutdown().finally(() => setTimeout(() => process.exit(0), 200).unref());
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason);
  });
  process.on('uncaughtException', (error) => {
    // Setelah uncaught exception state proses bisa korup: log, flush log, lalu keluar
    // (jalankan via supervisor seperti PM2/systemd agar otomatis restart).
    logger.error('Uncaught exception, keluar dari proses', error);
    Logger.shutdown().finally(() => process.exit(1));
  });

  await bot.start();
}

main().catch((error) => {
  new Logger('app').error('Bot gagal dijalankan', error);
  process.exit(1);
});
