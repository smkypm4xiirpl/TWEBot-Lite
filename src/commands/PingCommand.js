import { performance } from 'node:perf_hooks';
import { BaseCommand } from './BaseCommand.js';

export class PingCommand extends BaseCommand {
  #system;
  #provider;
  #formatter;
  #logger;

  constructor({ system, provider, formatter, logger = null }) {
    super({ name: 'ping', aliases: ['info', 'status'], description: 'Info server & kecepatan respons bot' });
    this.#system = system;
    this.#provider = provider;
    this.#formatter = formatter;
    this.#logger = logger;
  }

  async execute(ctx) {
    this.#logger?.debug(`PingCommand: dieksekusi oleh ${ctx?.senderLabel ?? 'unknown'}`);
    const startedAt = performance.now();
    const pending = await ctx.reply('🏓 _Mengukur kecepatan & mengumpulkan info server..._');
    const speedMs = performance.now() - startedAt; // waktu kirim pesan sampai diterima server

    this.#logger?.debug('PingCommand: mengumpulkan snapshot sistem & IP lookup...');
    const [system, provider] = await Promise.all([this.#system.snapshot(), this.#provider.lookup()]);
    this.#logger?.debug(`PingCommand: laporan siap (speed=${speedMs.toFixed(0)}ms), mengedit pesan respon...`);
    await ctx.edit(pending.key, this.#formatter.format({ speedMs, system, provider }));
  }
}
