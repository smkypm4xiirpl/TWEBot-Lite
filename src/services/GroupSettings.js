/**
 * Menentukan grup mana yang boleh dilayani bot.
 * Ada mode default (semua grup aktif/nonaktif) + override per grup, disimpan permanen.
 */
export class GroupSettings {
  #store;
  #defaultEnabledConfig;
  #currentAccountId = 'default';
  #accounts = new Map();

  constructor({ store, defaultEnabled }) {
    this.#store = store;
    this.#defaultEnabledConfig = defaultEnabled;
  }

  get #currentAccount() {
    let acc = this.#accounts.get(this.#currentAccountId);
    if (!acc) {
      acc = {
        defaultEnabled: this.#defaultEnabledConfig,
        privateOnly: false,
        overrides: new Map(),
        knownGroups: new Map(),
      };
      this.#accounts.set(this.#currentAccountId, acc);
    }
    return acc;
  }

  async init() {
    const saved = await this.#store.load(null);
    if (!saved) return;

    if (saved.accounts && typeof saved.accounts === 'object') {
      for (const [id, accData] of Object.entries(saved.accounts)) {
        const overrides = new Map();
        for (const [jid, enabled] of Object.entries(accData?.overrides ?? {})) {
          if (typeof enabled === 'boolean') overrides.set(jid, enabled);
        }
        const knownGroups = new Map();
        for (const [jid, name] of Object.entries(accData?.knownGroups ?? {})) {
          knownGroups.set(jid, typeof name === 'string' && name.trim() ? name.trim() : jid);
        }
        this.#accounts.set(id, {
          defaultEnabled: typeof accData?.defaultEnabled === 'boolean'
            ? accData.defaultEnabled
            : this.#defaultEnabledConfig,
          privateOnly: accData?.privateOnly === true,
          overrides,
          knownGroups,
        });
      }
      if (saved.currentAccount && this.#accounts.has(saved.currentAccount)) {
        this.#currentAccountId = saved.currentAccount;
      } else if (this.#accounts.size > 0) {
        this.#currentAccountId = this.#accounts.keys().next().value;
      }
      return;
    }

    // Legacy format (policyVersion 2 or no accounts map)
    const overrides = new Map();
    for (const [jid, enabled] of Object.entries(saved.overrides ?? {})) {
      if (typeof enabled === 'boolean') overrides.set(jid, enabled);
    }
    const knownGroups = new Map();
    for (const [jid, name] of Object.entries(saved.knownGroups ?? {})) {
      knownGroups.set(jid, typeof name === 'string' && name.trim() ? name.trim() : jid);
    }
    const defaultEnabled = (saved.policyVersion ?? 0) >= 2 && typeof saved.defaultEnabled === 'boolean'
      ? saved.defaultEnabled
      : false;

    this.#accounts.set('default', {
      defaultEnabled,
      privateOnly: saved.privateOnly === true,
      overrides,
      knownGroups,
    });
    this.#currentAccountId = 'default';
  }

  get currentAccountId() {
    return this.#currentAccountId;
  }

  bindAccount(accountId) {
    const cleanId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : 'default';
    if (this.#currentAccountId === cleanId) return Promise.resolve();

    this.#currentAccountId = cleanId;

    if (!this.#accounts.has(cleanId)) {
      if (this.#accounts.has('default') && this.#accounts.size === 1) {
        const defaultAcc = this.#accounts.get('default');
        this.#accounts.delete('default');
        this.#accounts.set(cleanId, defaultAcc);
      } else {
        this.#accounts.set(cleanId, {
          defaultEnabled: this.#defaultEnabledConfig,
          privateOnly: false,
          overrides: new Map(),
          knownGroups: new Map(),
        });
      }
      return this.#persist();
    }

    return Promise.resolve();
  }

  get defaultEnabled() {
    return this.#currentAccount.defaultEnabled;
  }

  get privateOnly() {
    return this.#currentAccount.privateOnly;
  }

  groups() {
    return [...this.#currentAccount.knownGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  hasGroup(jid) {
    return this.#currentAccount.knownGroups.has(jid);
  }

  getGroupName(jid) {
    return this.#currentAccount.knownGroups.get(jid) ?? null;
  }

  rememberGroup(jid, name = jid) {
    const acc = this.#currentAccount;
    const cleanJid = typeof jid === 'string' ? jid.trim() : '';
    if (!cleanJid) return Promise.resolve();
    const rawNormalized = typeof name === 'string' && name.trim() ? name.trim() : cleanJid;
    const existing = acc.knownGroups.get(cleanJid);
    const normalized = rawNormalized === cleanJid && existing ? existing : rawNormalized;
    if (existing === normalized) return Promise.resolve();
    acc.knownGroups.set(cleanJid, normalized);
    return this.#persist();
  }

  syncGroups(entries) {
    const acc = this.#currentAccount;
    const nextKnown = new Map();
    const iterable = entries && typeof entries[Symbol.iterator] === 'function'
      ? entries
      : Object.entries(entries ?? {});

    for (const item of iterable) {
      let jid = '';
      let name = '';
      if (Array.isArray(item)) {
        jid = item[0];
        name = item[1];
      } else if (typeof item === 'string') {
        jid = item;
        name = item;
      } else if (item && typeof item === 'object') {
        jid = item.id ?? item.jid ?? '';
        name = item.subject ?? item.name ?? jid;
      }
      const cleanJid = typeof jid === 'string' ? jid.trim() : '';
      if (!cleanJid) continue;
      const normalized = typeof name === 'string' && name.trim() ? name.trim() : cleanJid;
      nextKnown.set(cleanJid, normalized);
    }

    let changed = false;

    if (acc.knownGroups.size !== nextKnown.size) {
      changed = true;
    } else {
      for (const [jid, name] of nextKnown) {
        if (acc.knownGroups.get(jid) !== name) {
          changed = true;
          break;
        }
      }
    }

    for (const jid of [...acc.overrides.keys()]) {
      if (!nextKnown.has(jid)) {
        acc.overrides.delete(jid);
        changed = true;
      }
    }

    acc.knownGroups = nextKnown;

    return changed ? this.#persist() : Promise.resolve();
  }

  rememberGroups(entries) {
    return this.syncGroups(entries);
  }

  setPrivateOnly(enabled) {
    this.#currentAccount.privateOnly = enabled;
    return this.#persist();
  }

  isEnabled(jid) {
    const acc = this.#currentAccount;
    return acc.overrides.get(jid) ?? acc.defaultEnabled;
  }

  hasOverride(jid) {
    return this.#currentAccount.overrides.has(jid);
  }

  /** Daftar override: [[jid, enabled], ...] */
  overrides() {
    return [...this.#currentAccount.overrides.entries()];
  }

  setEnabled(jid, enabled) {
    this.#currentAccount.overrides.set(jid, enabled);
    return this.#persist();
  }

  reset(jid) {
    this.#currentAccount.overrides.delete(jid);
    return this.#persist();
  }

  setDefault(enabled) {
    this.#currentAccount.defaultEnabled = enabled;
    return this.#persist();
  }

  setAll(enabled) {
    const acc = this.#currentAccount;
    acc.defaultEnabled = enabled;
    acc.overrides.clear();
    return this.#persist();
  }

  #persist() {
    // Format tunggal (policyVersion 3): blok accounts + currentAccount.
    // Duplikat top-level legacy (defaultEnabled/overrides/knownGroups/privateOnly)
    // tidak ditulis lagi; init() tetap kompatibel membaca format lama.
    const accountsObj = {};
    for (const [id, acc] of this.#accounts.entries()) {
      accountsObj[id] = {
        defaultEnabled: acc.defaultEnabled,
        privateOnly: acc.privateOnly,
        overrides: Object.fromEntries(acc.overrides),
        knownGroups: Object.fromEntries(acc.knownGroups),
      };
    }

    return this.#store.save({
      policyVersion: 3,
      currentAccount: this.#currentAccountId,
      accounts: accountsObj,
    });
  }
}
