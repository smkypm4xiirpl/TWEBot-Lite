import { BotError } from '../errors/BotError.js';

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/** Mengurai argumen `packname|author` menjadi metadata sticker. */
export class StickerMetaParser {
  #defaultPack;
  #defaultAuthor;
  #maxLength;

  constructor({ defaultPack, defaultAuthor, maxLength }) {
    this.#defaultPack = defaultPack;
    this.#defaultAuthor = defaultAuthor;
    this.#maxLength = maxLength;
  }

  parse(rawArgs, senderName) {
    const fallbackAuthor = this.#defaultAuthor ?? senderName ?? this.#defaultPack;

    if (!rawArgs) {
      return { pack: this.#defaultPack, author: fallbackAuthor, custom: false };
    }

    const [rawPack = '', ...rawAuthor] = rawArgs.split('|');
    const pack = this.#sanitize(rawPack, 'Nama pack');
    const author = this.#sanitize(rawAuthor.join('|'), 'Nama author');

    return {
      pack: pack || this.#defaultPack,
      author: author || fallbackAuthor,
      custom: true,
    };
  }

  #sanitize(value, label) {
    const cleaned = value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length > this.#maxLength) {
      throw new BotError(`${label} terlalu panjang (maks ${this.#maxLength} karakter).`);
    }
    return cleaned;
  }
}
