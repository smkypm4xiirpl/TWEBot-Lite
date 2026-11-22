/** Mengurai teks pesan menjadi { prefix, name, args } bila diawali prefix. */
export class CommandParser {
  #prefixes;

  constructor(prefixes) {
    // Prefix terpanjang dicek dulu agar "!!" menang atas "!".
    this.#prefixes = [...prefixes].sort((a, b) => b.length - a.length);
  }

  parse(text) {
    const trimmed = text.trim();
    const prefix = this.#prefixes.find((candidate) => trimmed.startsWith(candidate));
    if (!prefix) return null;

    const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed.slice(prefix.length));
    if (!match) return null;

    return { prefix, name: match[1].toLowerCase(), args: (match[2] ?? '').trim() };
  }
}
