import { formatBytes, formatDuration, formatPercent, maskIp } from '../utils/formatters.js';
import { CPU_TIME_KEYS } from './SystemInfoService.js';

const MEMORY_BULLET = '📍';
const UNAVAILABLE = '_Tidak tersedia_';

/** Merender laporan `.ping` dengan format WhatsApp. Murni (tanpa I/O) sehingga mudah diuji. */
export class PingReportFormatter {
  format({ speedMs, system, provider }) {
    return [
      this.#serverInfo(speedMs, system),
      this.#providerInfo(provider),
      ['`RUNTIME OS`', `- _${formatDuration(system.osUptimeSeconds)}_`].join('\n'),
      ['`RUNTIME BOT`', `- _${formatDuration(system.botUptimeSeconds)}_`].join('\n'),
      this.#nodeMemory(system.node),
      this.#cpu(system),
    ].join('\n\n');
  }

  #serverInfo(speedMs, s) {
    return [
      '`INFO SERVER`',
      `- Speed Respons: _${speedMs.toFixed(2)} Milisecond(s)_`,
      `- Hostname: _${s.hostname}_`,
      `- CPU Core: _${s.cpuCount}_`,
      `- Platform : _${s.platform}_`,
      `- OS : _${s.osVersion} / ${s.osRelease}_`,
      `- Arch: _${s.arch}_`,
      `- Ram: _${formatBytes(s.memory.used)}_ / _${formatBytes(s.memory.total)}_`,
    ].join('\n');
  }

  #providerInfo(provider) {
    return [
      '`PROVIDER INFO`',
      `- IP: ${provider ? maskIp(provider.ip) : UNAVAILABLE}`,
      `- Region : ${provider?.region ? `_${provider.region}_` : UNAVAILABLE}`,
      `- ISP : ${provider?.isp ? `_${provider.isp}_` : UNAVAILABLE}`,
    ].join('\n');
  }

  #nodeMemory({ memory, heap }) {
    const bytes = (label, value, width = 0) => `*- ${label.padEnd(width)}${MEMORY_BULLET} ${formatBytes(value)}`;
    const plain = (label, value) => `*- ${label}${MEMORY_BULLET} ${value}`;

    return [
      '`NODE MEMORY USAGE`',
      bytes('rss', memory.rss, 13),
      bytes('heapTotal', memory.heapTotal, 13),
      bytes('heapUsed', memory.heapUsed, 13),
      bytes('external', memory.external, 13),
      bytes('arrayBuffers', memory.arrayBuffers, 13),
      bytes('Heap Executable ', heap.total_heap_size_executable),
      bytes('Physical Size ', heap.total_physical_size),
      bytes('Available Size ', heap.total_available_size),
      bytes('Heap Limit ', heap.heap_size_limit),
      bytes('Malloced Memory ', heap.malloced_memory),
      bytes('Peak Malloced Memory ', heap.peak_malloced_memory),
      plain('Does Zap Garbage ', heap.does_zap_garbage),
      plain('Native Contexts ', heap.number_of_native_contexts),
      plain('Detached Contexts ', heap.number_of_detached_contexts),
      bytes('Total Global Handles ', heap.total_global_handles_size),
      bytes('Used Global Handles ', heap.used_global_handles_size),
    ].join('\n');
  }

  #cpu({ cpu, cpuCount }) {
    if (!cpu) {
      return ['*_CPU Usage_*', `- ${UNAVAILABLE} (OS tidak menyediakan data CPU)`].join('\n');
    }

    const cores = cpu.cores.map((core, index) => `${index + 1}. ${this.#cpuTitle(core)}\n${this.#cpuLines(core.usage)}`);

    return [
      ['*_Total CPU Usage_*', this.#cpuTitle(cpu), this.#cpuLines(cpu.usage)].join('\n'),
      [`*_CPU Core(s) Usage (${cpuCount} Core CPU)_*`, cores.join('\n\n')].join('\n'),
    ].join('\n\n');
  }

  #cpuTitle({ model, speedMhz }) {
    return speedMhz > 0 ? `${model} (${speedMhz} MHZ)` : model;
  }

  #cpuLines(usage) {
    return CPU_TIME_KEYS.map(
      (key) => `*- ${key}*${' '.repeat(4 - key.length)} : ${formatPercent(usage[key])}`,
    ).join('\n');
  }
}
