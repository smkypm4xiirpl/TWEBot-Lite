/**
 * Bertanggung jawab mengirim pesan, media, reaksi, dan status kehadiran (SRP: Sender/Presence).
 */
export class MessageSender {
  #sock;
  #jid;
  #message;

  constructor({ sock, jid, message }) {
    this.#sock = sock;
    this.#jid = jid;
    this.#message = message;
  }

  reply(text) {
    return this.#sock.sendMessage(this.#jid, { text }, { quoted: this.#message });
  }

  async edit(key, text) {
    try {
      await this.#sock.sendMessage(this.#jid, { text, edit: key });
    } catch {
      await this.reply(text);
    }
  }

  sendSticker(buffer) {
    return this.#sock.sendMessage(this.#jid, { sticker: buffer }, { quoted: this.#message });
  }

  sendImage(buffer, caption) {
    return this.#sock.sendMessage(this.#jid, { image: buffer, caption }, { quoted: this.#message });
  }

  sendVideo(buffer, { caption, mimetype = 'video/mp4' } = {}) {
    return this.#sock.sendMessage(this.#jid, { video: buffer, mimetype, caption }, { quoted: this.#message });
  }

  sendGif(buffer, caption) {
    return this.#sock.sendMessage(
      this.#jid,
      { video: buffer, mimetype: 'video/mp4', gifPlayback: true, caption },
      { quoted: this.#message },
    );
  }

  sendAudio(buffer, { ptt = false, mimetype = 'audio/ogg; codecs=opus' } = {}) {
    return this.#sock.sendMessage(this.#jid, { audio: buffer, ptt, mimetype }, { quoted: this.#message });
  }

  async groupSubject(jid = this.#jid) {
    try {
      return (await this.#sock.groupMetadata(jid)).subject ?? null;
    } catch {
      return null;
    }
  }

  async groupMetadata(jid = this.#jid) {
    if (!this.#sock?.groupMetadata) return null;
    return this.#sock.groupMetadata(jid);
  }

  async groupSettingUpdate(jid, setting) {
    if (!this.#sock?.groupSettingUpdate) return null;
    return this.#sock.groupSettingUpdate(jid, setting);
  }

  async profilePictureUrl(jid) {
    try { return await this.#sock.profilePictureUrl(jid, 'image'); }
    catch (error) {
      if (error?.data === 404 || error?.status === 404 || error?.output?.statusCode === 404) return null;
      throw error;
    }
  }

  /**
   * Reaksi bersifat kosmetik dan fire-and-forget:
   * tidak memblokir alur eksekusi, kegagalan ditelan diam-diam.
   */
  react(emoji) {
    this.#sock.sendMessage(this.#jid, { react: { text: emoji, key: this.#message.key } }).catch(() => {});
    return Promise.resolve();
  }

  /**
   * Indikator mengetik non-blocking / fire-and-forget:
   * mengeliminasi delay round-trip jaringan.
   */
  setTyping(active) {
    this.#sock.sendPresenceUpdate(active ? 'composing' : 'paused', this.#jid).catch(() => {});
    return Promise.resolve();
  }
}
