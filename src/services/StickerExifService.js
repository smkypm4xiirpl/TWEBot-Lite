import { randomUUID } from 'node:crypto';
import webpmux from 'node-webpmux';

const { Image } = webpmux;

// Header EXIF (TIFF little-endian) yang dipakai WhatsApp untuk metadata sticker.
const EXIF_HEADER = Buffer.from([
  0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
  0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
]);

/** Menanam pack name & author ke dalam file WebP sticker. */
export class StickerExifService {
  async embed(webp, { pack, author }) {
    const exif = this.#buildExif({ pack, author });
    const image = new Image();
    await image.load(webp);
    image.exif = exif;
    return image.save(null);
  }

  #buildExif({ pack, author }) {
    const json = Buffer.from(
      JSON.stringify({
        'sticker-pack-id': randomUUID(),
        'sticker-pack-name': pack,
        'sticker-pack-publisher': author,
        emojis: [],
      }),
      'utf-8',
    );
    const exif = Buffer.concat([EXIF_HEADER, json]);
    exif.writeUIntLE(json.length, 14, 4);
    return exif;
  }
}
