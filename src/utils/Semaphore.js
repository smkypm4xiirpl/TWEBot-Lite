export class Semaphore {
  #max;
  #active = 0;
  #waiters = [];

  constructor(max = 1) {
    const parsed = Number.parseInt(max, 10);
    this.#max = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  async run(task) {
    await this.#acquire();
    try {
      return await task();
    } finally {
      this.#release();
    }
  }

  #acquire() {
    if (this.#active < this.#max) {
      this.#active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  #release() {
    const next = this.#waiters.shift();
    if (next) {
      next(); // slot langsung dioper ke waiter berikutnya
    } else {
      this.#active -= 1;
    }
  }
}
