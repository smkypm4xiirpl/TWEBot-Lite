# WhatsApp Sticker Bot (Baileys)

Bot WhatsApp ringan dengan fitur konversi sticker, anti view-once, dan manajemen grup.

| Command | Fungsi |
|---|---|
| `.sticker` / `.s` | Gambar / video (maks 7 dtk, otomatis dipotong) → sticker |
| `.s Pack\|Author` | Sama, dengan nama pack & author kustom |
| `.toimg` | Sticker → gambar (sticker animasi diambil frame pertamanya) |
| `.tovid` | Sticker animasi → video/GIF |
| `.avo` | Buka media view-once (reply foto/video/VN) |
| `.avo set [ID]` | Auto-forward semua view-once ke grup tujuan (owner only) |
| `.avo unset` | Nonaktifkan auto-forward view-once (owner only) |
| `.avo status` | Cek status auto-forward view-once (owner only) |

Kirim media dengan caption `.s`, atau **reply** media dengan `.s`. `.s help` menampilkan panduan.
Reply media view-once dengan `.avo` untuk membukanya. Owner dapat mengatur penerusan otomatis media view-once dengan `.avo set <idGroup>`.

## Menjalankan

```bash
npm install
cp .env.example .env     # opsional
npm start
```

Butuh Node.js 20+.

## Login (pairing code, tanpa QR)

Saat pertama kali jalan, bot menanyakan:

1. **Nomor WhatsApp** bot, contoh `628123456789` (format internasional, tanpa `+` dan tanpa `0` di depan).
2. **Kode pairing kustom** (opsional). Tepat 8 karakter: angka `1-9` dan huruf `A-Z` kecuali `I`, `O`, `U`. Tekan Enter untuk kode acak.

Lalu kode tampil di console. Di HP: **WhatsApp › Perangkat tertaut › Tautkan perangkat › Tautkan dengan nomor telepon saja**, masukkan kode.

Untuk server tanpa terminal interaktif (PM2/Docker), isi `PAIRING_NUMBER` (dan `PAIRING_CODE` jika mau) di `.env`.
Sesi tersimpan di `session/`. Jika logout, hapus folder itu lalu jalankan ulang.

Untuk mengunci versi Baileys: `npm i @whiskeysockets/baileys@<versi>`.

## Struktur

```
src/
├─ index.js                 # composition root (DI)
├─ config.js                # semua konfigurasi
├─ core/                    # koneksi, pairing, parser, registry, handler, context, logger
├─ commands/                # 1 class per command (UI/alur pesan)
├─ services/                # logika konversi (FFmpeg, sharp, EXIF, factory)
├─ utils/                   # Semaphore, withTempDir, StickerMetaParser
└─ errors/BotError.js       # error aman-tampil untuk pengguna
```

Menambah command: buat class turunan `BaseCommand`, lalu `registry.register(...)` di `index.js`.

### Akses grup dan log

Secara default bot tidak merespons command di grup. Owner dapat memakai `.bot list` untuk melihat nomor, nama, ID, dan status grup; `.bot allow 1,2` / `.bot disallow 1,2` untuk memilih grup; `.bot allow all` / `.bot disallow all` untuk semua grup; serta `.bot off` untuk membatasi bot ke chat pribadi. `.bot on` mengaktifkan kembali mode grup, tetap mengikuti izin tiap grup. `.getpp @user` mengirim foto profil user yang di-mention.

Log runtime ditambahkan ke `runtime-logs.txt`. Detail error termasuk stack dan cause ditambahkan ke `errors.txt`.

## Catatan

- Gunakan akun cadangan; Baileys adalah library tidak resmi dan ada risiko pembatasan akun.
- Jika ffmpeg-static tidak punya libwebp/libx264 di OS kamu, install ffmpeg sistem dan set `FFMPEG_PATH`.
- Log runtime ditulis ke `runtime-logs.txt` dan `errors.txt` (otomatis dirotasi saat mencapai 10 MB, disimpan sebagai `*.txt.1`). Nomor telepon di dalam log di-redaksi otomatis.
- Data runtime bot (`data/`, log) tidak disertakan dalam repositori Git — backup dilakukan di luar Git.
