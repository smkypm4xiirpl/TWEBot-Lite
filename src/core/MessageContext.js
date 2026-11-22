import { MediaDownloader } from './MediaDownloader.js';
import { MessageExtractor } from './MessageExtractor.js';
import { MessageSender } from './MessageSender.js';

/**
 * Konteks pesan (Facade): menyatukan ekstraksi pesan (parsing/DTO), downloader media,
 * dan sender ke dalam antarmuka terpadu untuk command handler (SRP compliant).
 */
export class MessageContext {
  #sock;
  #extractor;
  #downloader;
  #sender;
  #logger;

  constructor({
    sock,
    message,
    maxInputBytes,
    logger = null,
    extractor = new MessageExtractor({ message, sockUser: sock?.user }),
    downloader = new MediaDownloader({ sock, maxInputBytes, logger }),
    sender = new MessageSender({ sock, jid: message?.key?.remoteJid, message }),
  }) {
    this.#sock = sock;
    this.#extractor = extractor;
    this.#downloader = downloader;
    this.#sender = sender;
    this.#logger = logger;
  }

  get sock() {
    return this.#sock;
  }

  get senderJid() {
    return this.#extractor?.senderJid;
  }

  get sockUser() {
    return this.#sock?.user ?? this.#extractor?.sockUser;
  }

  get detectedTypes() {
    return this.#extractor?.detectedTypes ?? ['unknown'];
  }

  get jid() {
    return this.#extractor.jid;
  }

  get messageId() {
    return this.#extractor.messageId;
  }

  get quotedId() {
    return this.#extractor.quotedId;
  }

  get isGroup() {
    return this.#extractor.isGroup;
  }

  get fromMe() {
    return this.#extractor.fromMe;
  }

  get pushName() {
    return this.#extractor.pushName;
  }

  /** Semua ID (nomor HP maupun LID) milik pengirim, hanya bagian user. */
  get identityUsers() {
    return this.#extractor.identityUsers;
  }

  get senderLabel() {
    return this.#extractor.senderLabel;
  }

  get chatLabel() {
    return this.#extractor.chatLabel;
  }

  get text() {
    return this.#extractor.text;
  }

  get mentionedJids() { return this.#extractor.mentionedJids; }

  async profilePicture(jid) {
    this.#logger?.debug(`MessageContext: mengambil URL foto profil untuk ${jid}...`);
    const url = await this.#sender.profilePictureUrl(jid);
    if (!url) {
      this.#logger?.debug(`MessageContext: foto profil untuk ${jid} tidak ditemukan atau privat`);
      return null;
    }
    this.#logger?.debug(`MessageContext: mengunduh foto profil dari ${url}...`);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Unduhan foto profil gagal: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Foto profil melebihi batas 8 MB.');
    this.#logger?.debug(`MessageContext: unduhan foto profil selesai (${(bytes.length / 1024).toFixed(1)} KB)`);
    return bytes;
  }

  /**
   * Cari media pada pesan ini lalu pada pesan yang di-reply.
   * `scope`: 'any' (default) | 'own' | 'quoted'.
   */
  findMedia(allowedTypes, options) {
    return this.#extractor.findMedia(allowedTypes, options);
  }

  download(media, options) {
    return this.#downloader.download(media, options);
  }

  reply(text) {
    return this.#sender.reply(text);
  }

  /** Edit pesan milik bot; bila gagal, kirim sebagai balasan baru. */
  edit(key, text) {
    return this.#sender.edit(key, text);
  }

  sendSticker(buffer) {
    return this.#sender.sendSticker(buffer);
  }

  sendImage(buffer, caption) {
    return this.#sender.sendImage(buffer, caption);
  }

  sendVideo(buffer, options) {
    return this.#sender.sendVideo(buffer, options);
  }

  /** Dikirim sebagai GIF (autoplay & loop) di WhatsApp. */
  sendGif(buffer, caption) {
    return this.#sender.sendGif(buffer, caption);
  }

  sendAudio(buffer, options) {
    return this.#sender.sendAudio(buffer, options);
  }

  /** Nama grup, atau null bila tidak bisa diambil. */
  groupSubject(jid) {
    return this.#sender.groupSubject(jid);
  }

  groupMetadata(jid = this.jid) {
    if (this.#sender?.groupMetadata) return this.#sender.groupMetadata(jid);
    return this.#sock?.groupMetadata?.(jid);
  }

  groupSettingUpdate(arg1, arg2) {
    let jid = this.jid;
    let setting = arg1;
    if (typeof arg1 === 'string' && (arg1.endsWith('@g.us') || arg1.includes('@'))) {
      jid = arg1;
      setting = arg2;
    } else if (arg2 && typeof arg2 === 'string') {
      jid = arg2;
      setting = arg1;
    }
    if (this.#sender?.groupSettingUpdate) return this.#sender.groupSettingUpdate(jid, setting);
    return this.#sock?.groupSettingUpdate?.(jid, setting);
  }

  /** Reaksi bersifat kosmetik dan fire-and-forget. */
  react(emoji) {
    return this.#sender.react(emoji);
  }

  /** Indikator mengetik non-blocking / fire-and-forget. */
  setTyping(active) {
    return this.#sender.setTyping(active);
  }
}
