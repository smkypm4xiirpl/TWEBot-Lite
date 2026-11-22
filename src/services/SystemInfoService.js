import os from 'node:os';
import v8 from 'node:v8';

export const CPU_TIME_KEYS = Object.freeze(['user', 'nice', 'sys', 'idle', 'irq']);

/** Mengumpulkan data server (OS, RAM, CPU, memori Node). Tidak tahu soal format tampilan. */
export class SystemInfoService {
  #lastCpu;
  #cachedUsage = null;
  #timer = null;

  constructor({ cpuSampleMs = 2000 } = {}) {
    this.#lastCpu = os.cpus();
    if (cpuSampleMs > 0) {
      this.#timer = setInterval(() => {
        const next = os.cpus();
        this.#cachedUsage = this.#cpuUsage(this.#lastCpu, next);
        this.#lastCpu = next;
      }, cpuSampleMs);
      this.#timer.unref?.();
    }
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async snapshot() {
    const nowCpus = os.cpus();
    const cpu = this.#cachedUsage ?? this.#cpuUsage(this.#lastCpu, nowCpus);

    const totalMemory = os.totalmem();
    return {
      hostname: os.hostname(),
      cpuCount: nowCpus.length || os.availableParallelism(),
      platform: os.platform(),
      osVersion: os.version(),
      osRelease: os.release(),
      arch: os.arch(),
      memory: { used: totalMemory - os.freemem(), total: totalMemory },
      osUptimeSeconds: os.uptime(),
      botUptimeSeconds: process.uptime(),
      node: { memory: process.memoryUsage(), heap: v8.getHeapStatistics() },
      cpu,
    };
  }

  /** null bila OS tidak mengekspos data CPU (mis. beberapa lingkungan Android/Termux). */
  #cpuUsage(before, after) {
    if (before.length === 0 || before.length !== after.length) return null;

    const totals = Object.fromEntries(CPU_TIME_KEYS.map((key) => [key, 0]));
    const cores = after.map((core, index) => {
      const deltas = Object.fromEntries(
        CPU_TIME_KEYS.map((key) => [key, Math.max(0, core.times[key] - before[index].times[key])]),
      );
      for (const key of CPU_TIME_KEYS) totals[key] += deltas[key];
      return { model: core.model.trim(), speedMhz: core.speed, usage: this.#toPercentages(deltas) };
    });

    return {
      model: cores[0].model,
      speedMhz: cores[0].speedMhz,
      usage: this.#toPercentages(totals),
      cores,
    };
  }

  #toPercentages(deltas) {
    const sum = CPU_TIME_KEYS.reduce((acc, key) => acc + deltas[key], 0);
    return Object.fromEntries(
      CPU_TIME_KEYS.map((key) => [key, sum > 0 ? (deltas[key] / sum) * 100 : key === 'idle' ? 100 : 0]),
    );
  }
}
