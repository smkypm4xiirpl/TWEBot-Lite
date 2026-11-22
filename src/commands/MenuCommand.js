import { BaseCommand } from './BaseCommand.js';
import { formatDuration } from '../utils/formatters.js';

const INDONESIAN_DAYS = Object.freeze(['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']);
const INDONESIAN_MONTHS = Object.freeze([
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]);

/**
 * Menampilkan menu interaktif dan daftar perintah bot.
 * Menyesuaikan tampilan berdasarkan hak akses pengirim (user biasa vs owner).
 */
export class MenuCommand extends BaseCommand {
  #botName;
  #prefix;
  #owners;
  #uptimeProvider;
  #logger;

  constructor({
    botName = 'TWEBot-Lite',
    prefix = '.',
    owners = null,
    uptimeProvider = () => process.uptime(),
    logger = null,
    alwaysAvailable = true,
  } = {}) {
    super({
      name: 'menu',
      aliases: ['help'],
      description: 'Menampilkan daftar menu dan fitur bot',
      alwaysAvailable,
    });
    this.#botName = botName || 'TWEBot-Lite';
    this.#prefix = prefix || '.';
    this.#owners = owners;
    this.#uptimeProvider = uptimeProvider;
    this.#logger = logger;
  }

  async execute(ctx) {
    this.#logger?.debug(`MenuCommand: dieksekusi oleh ${ctx?.senderLabel ?? 'unknown'}`);
    try {
      const reaction = ctx?.react?.('✨');
      if (reaction && typeof reaction.catch === 'function') {
        reaction.catch(() => {});
      }
    } catch {
      // react bersifat best-effort
    }
    const text = this.buildMenu(ctx);
    return ctx?.reply(text);
  }

  buildMenu(ctx = {}) {
    const isOwner = this.#checkIsOwner(ctx);
    const rawName = ctx?.pushName?.trim() || ctx?.senderLabel || 'Kak';
    const userName = rawName.replace(/[\r\n]+/g, ' ').trim() || 'Kak';
    const { dateStr, timeStr, greeting } = this.#getDateTimeInfo();
    const uptimeSeconds = typeof this.#uptimeProvider === 'function' ? this.#uptimeProvider() : process.uptime();
    const uptime = formatDuration(uptimeSeconds);
    const p = this.#prefix;

    const sections = [
      this.#renderHeader({ userName, greeting, dateStr, timeStr, uptime, isOwner }),
      this.#renderStickerCategory(p),
      this.#renderAntiViewOnceCategory(p, isOwner),
      this.#renderGroupCategory(p),
      this.#renderUtilityCategory(p),
    ];

    if (isOwner) {
      sections.push(this.#renderOwnerCategory(p));
    }

    sections.push(this.#renderFooter(p));

    return sections.join('\n\n');
  }

  #checkIsOwner(ctx) {
    if (!ctx) return false;
    if (ctx.fromMe) return true;
    if (this.#owners && typeof this.#owners.isOwner === 'function') {
      try {
        return Boolean(this.#owners.isOwner(ctx));
      } catch {
        return false;
      }
    }
    return false;
  }

  #getDateTimeInfo(date = new Date()) {
    try {
      const dateStr = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(date);

      const timeStr = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);

      const hour = Number(
        new Intl.DateTimeFormat('id-ID', {
          timeZone: 'Asia/Jakarta',
          hour: 'numeric',
          hour12: false,
        }).format(date),
      );

      let greeting = 'Selamat Malam';
      if (hour >= 4 && hour < 11) greeting = 'Selamat Pagi';
      else if (hour >= 11 && hour < 15) greeting = 'Selamat Siang';
      else if (hour >= 15 && hour < 18) greeting = 'Selamat Sore';

      return { dateStr, timeStr: `${timeStr} WIB`, greeting };
    } catch {
      // Fallback robust dengan konversi UTC+7 (WIB) dan nama hari/bulan bahasa Indonesia
      const validDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
      const wibDate = new Date(validDate.getTime() + (validDate.getTimezoneOffset() * 60 * 1000) + (7 * 3600 * 1000));
      const hour = wibDate.getHours();

      let greeting = 'Selamat Malam';
      if (hour >= 4 && hour < 11) greeting = 'Selamat Pagi';
      else if (hour >= 11 && hour < 15) greeting = 'Selamat Siang';
      else if (hour >= 15 && hour < 18) greeting = 'Selamat Sore';

      const dayName = INDONESIAN_DAYS[wibDate.getDay()] ?? 'Hari';
      const monthName = INDONESIAN_MONTHS[wibDate.getMonth()] ?? '';
      const dateStr = `${dayName}, ${wibDate.getDate()} ${monthName} ${wibDate.getFullYear()}`.trim();
      const timeStr = `${hour.toString().padStart(2, '0')}.${wibDate.getMinutes().toString().padStart(2, '0')} WIB`;

      return { dateStr, timeStr, greeting };
    }
  }

  #renderHeader({ userName, greeting, dateStr, timeStr, uptime, isOwner }) {
    return [
      `╭───「 *${this.#botName}* 」`,
      `│ 👋 Halo, *${userName}*! (${greeting})`,
      `│ 📅 ${dateStr}`,
      `│ ⏰ ${timeStr}`,
      `│ ⏳ Runtime: _${uptime}_`,
      `│ ⚡ Prefix: *[ ${this.#prefix} ]*`,
      `│ 👤 Status: *${isOwner ? '👑 Owner' : 'Standard User'}*`,
      `╰────────────────────────`,
    ].join('\n');
  }

  #renderStickerCategory(p) {
    return [
      `╭─ 🎨 *CONVERT & STICKER*`,
      `├── \`${p}s\` / \`${p}sticker [pack|author]\``,
      `│   _Ubah gambar, video, atau gif jadi stiker WA_`,
      `├── \`${p}smeme <atas> | <bawah>\``,
      `│   _Buat stiker meme teks Impact (gambar/stiker)_`,
      `├── \`${p}brat [-w] <teks>\``,
      `│   _Buat stiker teks viral estetik Brat Charli XCX_`,
      `├── \`${p}toimg\``,
      `│   _Konversi stiker biasa/bergerak ke gambar_`,
      `└── \`${p}tovid\``,
      `    _Ubah stiker gerak animasi ke video MP4_`,
      `╰────────────────────────`,
    ].join('\n');
  }

  #renderAntiViewOnceCategory(p, isOwner) {
    if (isOwner) {
      return [
        `╭─ 👁️ *ANTI VIEW ONCE*`,
        `├── \`${p}avo\``,
        `│   _Buka media sekali-lihat (reply foto/video/VN)_`,
        `├── \`${p}avo status\``,
        `│   _Cek status & target auto-forward View Once (owner only)_`,
        `└── \`${p}avo set <ID>\` / \`${p}avo unset\``,
        `    _Atur atau hapus grup auto-forward View Once (owner only)_`,
        `╰────────────────────────`,
      ].join('\n');
    }
    return [
      `╭─ 👁️ *ANTI VIEW ONCE*`,
      `└── \`${p}avo\``,
      `    _Buka media sekali-lihat (reply foto/video/VN)_`,
      `╰────────────────────────`,
    ].join('\n');
  }

  #renderGroupCategory(p) {
    return [
      `╭─ 👥 *GROUP SETTING*`,
      `├── \`${p}closegc\` / \`${p}tutup\``,
      `│   _Tutup grup: hanya admin yang dapat mengirim pesan_`,
      `└── \`${p}opengc\` / \`${p}buka\``,
      `    _Buka grup: semua member dapat mengirim pesan_`,
      `╰────────────────────────`,
    ].join('\n');
  }

  #renderUtilityCategory(p) {
    return [
      `╭─ 🛠️ *UTILITY & INFO*`,
      `├── \`${p}ping\``,
      `│   _Cek kecepatan respons bot, OS, RAM & status server_`,
      `└── \`${p}getpp [@user / reply]\``,
      `    _Ambil foto profil akun WhatsApp target_`,
      `╰────────────────────────`,
    ].join('\n');
  }

  #renderOwnerCategory(p) {
    return [
      `╭─ 👑 *OWNER CONTROL*`,
      `├── \`${p}bot status\``,
      `│   _Cek status aktif bot di grup & mode private_`,
      `├── \`${p}bot list\``,
      `│   _Daftar grup terdaftar beserta nomor & ID_`,
      `├── \`${p}bot allow <no|all>\` / \`${p}bot disallow <no|all>\``,
      `│   _Aktifkan atau nonaktifkan respon bot di grup_`,
      `├── \`${p}bot on\` / \`${p}bot off\``,
      `│   _Beralih antara mode grup dan chat pribadi saja_`,
      `├── \`${p}bot reset [ID]\``,
      `│   _Reset setelan grup bot ke konfigurasi default_`,
      `└── \`${p}bot default on|off\``,
      `    _Atur default grup baru: diizinkan atau dinonaktifkan_`,
      `╰────────────────────────`,
    ].join('\n');
  }

  #renderFooter(p) {
    return [
      `╭────────────────────────`,
      `│ 💡 _Gunakan perintah dengan awalan prefix_ *${p}*`,
      `╰────────────────────────`,
    ].join('\n');
  }
}
