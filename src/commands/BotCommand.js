import { BotError } from '../errors/BotError.js';
import { BaseCommand } from './BaseCommand.js';

const GROUP_JID_PATTERN = /^\d+(?:-\d+)?@g\.us$/;
const LIST_CHUNK_SIZE = 35;

/** Manajemen izin bot per grup dan mode chat pribadi. */
export class BotCommand extends BaseCommand {
  #groups;
  #prefix;
  #logger;

  constructor({ groups, prefix, logger = null }) {
    super({ name: 'bot', description: 'Kelola izin bot di grup (owner only)', ownerOnly: true, alwaysAvailable: true });
    this.#groups = groups;
    this.#prefix = prefix;
    this.#logger = logger;
  }

  async execute(ctx, args) {
    const [rawAction = 'status', ...rest] = args.split(/\s+/).filter(Boolean);
    const action = rawAction.toLowerCase();
    this.#logger?.debug(`BotCommand: aksi "${action}" dieksekusi oleh ${ctx?.senderLabel ?? 'unknown'} (args: "${args}")`);
    switch (action) {
      case 'allow': return this.#setMany(ctx, rest.join(' '), true);
      case 'disallow': return this.#setMany(ctx, rest.join(' '), false);
      case 'on':
        if (!rest.length) return this.#setPrivateOnly(ctx, false);
        return this.#setOne(ctx, rest[0], true);
      case 'off':
        if (!rest.length) return this.#setPrivateOnly(ctx, true);
        return this.#setOne(ctx, rest[0], false);
      case 'reset': return this.#reset(ctx, rest[0]);
      case 'status': return this.#status(ctx, rest[0]);
      case 'list': return this.#list(ctx);
      case 'default': return this.#setDefault(ctx, rest[0]);
      case 'help': return this.#help(ctx);
      default:
        await ctx.react('❓');
        return this.#help(ctx);
    }
  }

  async #setMany(ctx, rawTargets, enabled) {
    const target = rawTargets.replace(/\s+/g, '');
    if (!target) throw new BotError(`Gunakan *${this.#prefix}bot ${enabled ? 'allow' : 'disallow'} <nomor|all>*.`);
    if (target.toLowerCase() === 'all') {
      await this.#groups.setAll(enabled);
      if (enabled && this.#groups.privateOnly) await this.#groups.setPrivateOnly(false);
      await ctx.react(enabled ? '🟢' : '🔴');
      return ctx.reply(enabled
        ? '🟢 Bot diizinkan di semua grup (termasuk grup baru).'
        : '🔴 Bot dinonaktifkan di semua grup (termasuk grup baru).');
    }

    const targets = target.split(',');
    if (targets.some((part) => !part)) throw new BotError('Nomor grup harus dipisahkan dengan koma, contoh: *1,2,6*.');
    const groups = this.#groups.groups();
    const selections = targets.map((part) => {
      if (GROUP_JID_PATTERN.test(part)) return [part, groups.find(([jid]) => jid === part)?.[1] ?? part];
      if (!/^\d+$/.test(part)) throw new BotError(`Nomor grup tidak valid: *${part}*. Lihat daftar dengan *${this.#prefix}bot list*.`);
      const index = Number(part);
      if (index < 1 || index > groups.length) throw new BotError(`Nomor grup *${part}* tidak ada. Lihat daftar dengan *${this.#prefix}bot list*.`);
      return groups[index - 1];
    });
    for (const [jid] of selections) await this.#groups.setEnabled(jid, enabled);
    await ctx.react(enabled ? '🟢' : '🔴');
    return ctx.reply(`${enabled ? '🟢 Diizinkan' : '🔴 Dinonaktifkan'}: ${selections.map(([jid, name]) => `*${name}* (${jid})`).join(', ')}`);
  }

  async #setOne(ctx, target, enabled) {
    const jid = this.#resolveTarget(ctx, target);
    await this.#groups.rememberGroup(jid, await this.#groupName(ctx, jid));
    await this.#groups.setEnabled(jid, enabled);
    await ctx.react(enabled ? '🟢' : '🔴');
    const name = await this.#groupName(ctx, jid);
    return ctx.reply(`${enabled ? '🟢 Bot diaktifkan' : '🔴 Bot dinonaktifkan'} di grup *${name}*.`);
  }

  async #setPrivateOnly(ctx, enabled) {
    await this.#groups.setPrivateOnly(enabled);
    await ctx.react(enabled ? '🔒' : '🔓');
    return ctx.reply(enabled
      ? '🔒 Mode chat pribadi saja aktif. Bot tidak akan merespons pesan grup.'
      : '🔓 Mode grup aktif kembali. Izin masing-masing grup tetap mengikuti daftar.');
  }

  async #reset(ctx, target) {
    const jid = this.#resolveTarget(ctx, target);
    await this.#groups.reset(jid);
    await ctx.react('♻️');
    return ctx.reply(`♻️ Pengaturan grup *${await this.#groupName(ctx, jid)}* kembali mengikuti default (${this.#groups.defaultEnabled ? 'aktif' : 'nonaktif'}).`);
  }

  async #status(ctx, target) {
    const jid = this.#optionalTarget(ctx, target);
    const lines = ['🤖 *STATUS BOT*', ''];
    if (jid) lines.push(`👥 Grup: *${await this.#groupName(ctx, jid)}*`, `🆔 ID: ${jid}`, `📌 Status: ${this.#isEffectivelyEnabled(jid) ? '🟢 Diizinkan' : '🔴 Dinonaktifkan'}`, '');
    lines.push(`⚙️ Default grup: ${this.#groups.defaultEnabled ? '🟢 Diizinkan' : '🔴 Nonaktif'}`,
      `🔐 Mode pribadi saja: ${this.#groups.privateOnly ? 'aktif' : 'nonaktif'}`,
      `🗂️ Grup tercatat: ${this.#groups.groups().length}`, '', `_Ketik ${this.#prefix}bot help untuk bantuan._`);
    return ctx.reply(lines.join('\n'));
  }

  async #list(ctx) {
    const entries = this.#groups.groups();
    if (!entries.length) return ctx.reply('🗂️ Belum ada grup yang tercatat. Grup akan muncul setelah bot menerima data grupnya.');
    const lines = entries.map(([jid, name], index) =>
      `${index + 1}. ${this.#isEffectivelyEnabled(jid) ? '🟢 ENABLE' : '🔴 DISABLE'} — *${name}*\n   ID: ${jid}`);
    const chunks = [];
    for (let index = 0; index < lines.length; index += LIST_CHUNK_SIZE) {
      chunks.push(lines.slice(index, index + LIST_CHUNK_SIZE));
    }
    for (let index = 0; index < chunks.length; index += 1) {
      const heading = index === 0
        ? ['🗂️ *DAFTAR GRUP BOT*', '_Nomor dapat dipakai pada bot allow/disallow._', '']
        : [`🗂️ *DAFTAR GRUP BOT (${index + 1}/${chunks.length})*`, ''];
      await ctx.reply([...heading, ...chunks[index]].join('\n'));
    }
  }

  async #setDefault(ctx, value) {
    const choice = value?.toLowerCase();
    if (choice !== 'on' && choice !== 'off') throw new BotError(`Gunakan *${this.#prefix}bot default on* atau *${this.#prefix}bot default off*.`);
    await this.#groups.setDefault(choice === 'on');
    await ctx.react('⚙️');
    return ctx.reply(`⚙️ Default grup: bot ${choice === 'on' ? 'diizinkan' : 'dinonaktifkan'} untuk grup baru dan grup tanpa pengaturan khusus.`);
  }

  async #help(ctx) {
    const p = this.#prefix;
    return ctx.reply([
      '🛠️ *MANAJEMEN BOT* _(owner only)_', '',
      `├ *${p}bot list* — daftar grup, nomor, ID, dan status`,
      `├ *${p}bot allow 1,2,6* — izinkan bot di grup terpilih`,
      `├ *${p}bot disallow 1,2* — nonaktifkan bot di grup terpilih`,
      `├ *${p}bot allow all* / *${p}bot disallow all* — izinkan/nonaktifkan semua grup`,
      `├ *${p}bot off* — mode chat pribadi saja`,
      `├ *${p}bot on* — aktifkan kembali mode grup`,
      `├ *${p}bot reset [ID grup]* — hapus pengaturan khusus`,
      `└ *${p}bot status* — lihat konfigurasi`, '',
      `Untuk satu grup, pilih nomornya: *${p}bot allow 1* atau *${p}bot disallow 1*.`,
    ].join('\n'));
  }

  #optionalTarget(ctx, target) {
    if (target && GROUP_JID_PATTERN.test(target)) return target;
    return ctx.isGroup ? ctx.jid : null;
  }

  #resolveTarget(ctx, target) {
    const jid = this.#optionalTarget(ctx, target);
    if (!jid) throw new BotError(`Gunakan di grup, atau sertakan ID grup: *${this.#prefix}bot off 1203630xxxx@g.us*.`);
    return jid;
  }

  async #groupName(ctx, jid) {
    const known = this.#groups.getGroupName?.(jid) ?? this.#groups.groups().find(([groupJid]) => groupJid === jid)?.[1];
    return known ?? (await ctx.groupSubject(jid)) ?? jid;
  }

  #isEffectivelyEnabled(jid) {
    return !this.#groups.privateOnly && this.#groups.isEnabled(jid);
  }
}
