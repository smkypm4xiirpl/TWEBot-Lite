import {
  areJidsSameUser,
  getContentType,
  jidDecode,
  normalizeMessageContent,
} from '@whiskeysockets/baileys';

const VIEW_ONCE_WRAPPERS = new Set(['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']);
const WRAPPER_KEYS = Object.freeze([
  ...VIEW_ONCE_WRAPPERS,
  'ephemeralMessage',
  'documentWithCaptionMessage',
  'editedMessage',
  'associatedChildMessage',
  'deviceSentMessage',
  'groupStatusMessage',
  'groupStatusMessageV2',
  'botInvokeMessage',
]);

/** Deteksi pembungkus view-once pada struktur raw Baileys. */
export function hasViewOnceWrapper(raw, depth = 0) {
  if (!raw || typeof raw !== 'object' || depth > 8) return false;

  if (raw.viewOnce === true) return true;

  for (const key of WRAPPER_KEYS) {
    const val = raw[key];
    if (val) {
      if (VIEW_ONCE_WRAPPERS.has(key)) return true;
      if (val.viewOnce === true) return true;
      if (val.message && hasViewOnceWrapper(val.message, depth + 1)) return true;
    }
  }

  for (const [key, val] of Object.entries(raw)) {
    if (WRAPPER_KEYS.includes(key)) continue;
    if (val && typeof val === 'object') {
      if (val.viewOnce === true) return true;
      if (val.message && hasViewOnceWrapper(val.message, depth + 1)) return true;
    }
  }

  return false;
}

/** Menentukan apakah pesan yang dikutip berasal dari bot sendiri (fromMe). */
export function isQuotedFromMe(info, isGroup, incomingFromMe, sockUser) {
  if (info?.participant) {
    const meId = sockUser?.id;
    const meLid = sockUser?.lid;
    return (
      areJidsSameUser(info.participant, meId) ||
      (Boolean(meLid) && areJidsSameUser(info.participant, meLid))
    );
  }
  if (!isGroup) {
    return !incomingFromMe;
  }
  return false;
}

/**
 * Bertanggung jawab mengekstrak data dan struktur dari pesan Baileys (SRP: Parsing/DTO).
 */
export class MessageExtractor {
  #message;
  #sockUser;
  #sources;

  constructor({ message, sockUser }) {
    this.#message = message;
    this.#sockUser = sockUser;
    this.#sources = this.#buildSources();
  }

  get sources() {
    return this.#sources;
  }

  get jid() {
    return this.#message.key.remoteJid;
  }

  get messageId() {
    return this.#message.key.id ?? null;
  }

  get quotedId() {
    return this.#sources.find((source) => source.scope === 'quoted')?.key.id ?? null;
  }

  get isGroup() {
    return this.jid.endsWith('@g.us');
  }

  get fromMe() {
    return Boolean(this.#message.key.fromMe);
  }

  get pushName() {
    return this.#message.pushName?.trim() || null;
  }

  get identityUsers() {
    const { participant, participantAlt, remoteJidAlt, remoteJid } = this.#message.key;
    const jids = [participant, participantAlt, remoteJidAlt, this.#message.participant, this.isGroup ? null : remoteJid];
    const users = jids.filter(Boolean).map((jid) => jidDecode(jid)?.user).filter(Boolean);
    return [...new Set(users)];
  }

  get senderJid() {
    const { participant, participantAlt, remoteJidAlt, remoteJid } = this.#message.key;
    return participantAlt ?? remoteJidAlt ?? participant ?? this.#message.participant ?? (this.isGroup ? null : remoteJid);
  }

  get sockUser() {
    return this.#sockUser;
  }

  get senderLabel() {
    const { participant, participantAlt, remoteJidAlt, remoteJid } = this.#message.key;
    const jid = participantAlt ?? remoteJidAlt ?? participant ?? this.#message.participant ?? (this.isGroup ? null : remoteJid);
    const user = jid ? (jidDecode(jid)?.user ?? jid) : 'unknown';
    return this.pushName ? `${this.pushName} (${user})` : user;
  }

  get chatLabel() {
    return this.isGroup ? 'Grup' : 'Private';
  }

  get text() {
    const c = this.#sources[0]?.content ?? {};
    return c.conversation ?? c.extendedTextMessage?.text ?? c.imageMessage?.caption ?? c.videoMessage?.caption ?? '';
  }

  get mentionedJids() {
    const content = this.#sources[0]?.content ?? {};
    const type = getContentType(content);
    return content[type]?.contextInfo?.mentionedJid ?? [];
  }

  get detectedTypes() {
    const types = [];
    const ownContent = this.#sources[0]?.content ?? {};
    const ownType = getContentType(ownContent);
    if (ownType) {
      if (ownType === 'conversation' || ownType === 'extendedTextMessage') {
        types.push('text');
      } else {
        types.push(ownType.replace(/Message$/, '').toLowerCase());
      }
    }
    const isViewOnce = Boolean(this.#sources[0]?.viewOnce || ownContent[ownType]?.viewOnce);
    if (isViewOnce) {
      types.push('view-once');
    }

    const quotedSource = this.#sources.find((s) => s.scope === 'quoted');
    if (quotedSource) {
      const qType = getContentType(quotedSource.content);
      const friendlyQType = qType
        ? (qType === 'conversation' || qType === 'extendedTextMessage'
            ? 'text'
            : qType.replace(/Message$/, '').toLowerCase())
        : 'unknown';
      const isQuotedViewOnce = Boolean(quotedSource.viewOnce || quotedSource.content?.[qType]?.viewOnce);
      types.push(`quoted:${friendlyQType}${isQuotedViewOnce ? ' (view-once)' : ''}`);
    }

    return types.length > 0 ? types : ['unknown'];
  }

  findMedia(allowedTypes, { scope = 'any' } = {}) {
    for (const source of this.#sources) {
      if (scope !== 'any' && source.scope !== scope) continue;

      const type = getContentType(source.content);
      if (type && allowedTypes.includes(type)) {
        const node = source.content[type];
        return Object.freeze({
          type,
          node,
          key: source.key,
          viewOnce: Boolean(node?.viewOnce) || source.viewOnce,
        });
      }
    }
    return null;
  }

  #buildSources() {
    const raw = this.#message.message;
    const own = {
      scope: 'own',
      content: normalizeMessageContent(raw) ?? {},
      key: this.#message.key,
      viewOnce: hasViewOnceWrapper(raw),
    };

    const type = getContentType(own.content);
    const info = type ? own.content[type]?.contextInfo : undefined;
    if (!info?.quotedMessage) return [own];

    const quoted = {
      scope: 'quoted',
      content: normalizeMessageContent(info.quotedMessage) ?? {},
      key: {
        remoteJid: this.jid,
        id: info.stanzaId,
        participant: info.participant,
        fromMe: isQuotedFromMe(info, this.isGroup, this.fromMe, this.#sockUser),
      },
      viewOnce: hasViewOnceWrapper(info.quotedMessage),
    };
    return [own, quoted];
  }
}
