export class CommandRegistry {
  #commands = new Map();
  #unique = new Set();

  register(command) {
    for (const key of [command.name, ...command.aliases]) {
      if (this.#commands.has(key)) {
        throw new Error(`Command "${key}" sudah terdaftar.`);
      }
      this.#commands.set(key, command);
    }
    this.#unique.add(command);
    return this;
  }

  resolve(name) {
    return this.#commands.get(name) ?? null;
  }

  all() {
    return [...this.#unique];
  }
}
