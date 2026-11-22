# LAPORAN AUDIT ENGINEERING — TWEBot-Lite

> **Tanggal audit:** 23 November 2026
> **STATUS PERBAIKAN (update):** Sebagian besar temuan P0/P1/P2 telah DIPERBAIKI — lihat "Riwayat Perbaikan" di akhir file. Temuan yang masih terbuka: kebersihan fisik file log/data (menunggu keputusan), penambahan CI/lint/coverage, dan dokumentasi supervisor (PM2/systemd).
> **Cakupan:** Seluruh source code `src/` (46 file, ±4.229 baris), `test/` (9 file, ±3.418 baris), `package.json`, `package-lock.json`, `README.md`, `requirements.txt`, `.env` / `.env.example`, artefak data (`data/`, `datas/`, root `*.json`), artefak log (`runtime-logs.txt`, `errors.txt`).
> **Sifat audit:** Read-only. Tidak ada kode proyek yang diubah. Laporan ini ditulis sebagai **landasan perbaikan oleh AI/manusia** — setiap temuan dilengkapi lokasi (file:baris), bukti, dan rekomendasi konkret.
> **Batasan audit:** `node_modules` tidak terinstal di mesin audit, jadi tidak ada pengujian runtime / benchmark nyata. Tidak ada pengukuran coverage. Semua klaim performa didasarkan pada analisis statis kode dan artefak log yang ada, bukan benchmark. Ini diungkapkan secara jujur sebagai keterbatasan.

---

## 1. RINGKASAN EKSEKUTIF

### Apa yang dilakukan proyek ini
TWEBot-Lite adalah **bot WhatsApp personal/kelompok kecil berbasis Baileys** (library tidak resmi WhatsApp Web) dengan fokus utama konversi sticker (`.s`/`.sticker`, `.smeme`, `.brat`, `.toimg`, `.tovid`), pembuka media view-once (`.avo` + auto-forward), manajemen akses grup (`.bot`), setting grup (`.closegc`/`.opengc`), foto profil (`.getpp`), menu (`.menu`), dan info server (`.ping`). Target deployment: VPS pribadi via Node.js 20+ (ESM).

### Penilaian arsitektur secara umum
Arsitektur **lebih baik dari rata-rata proyek bot WhatsApp sejenis**: ada composition root dengan dependency injection eksplisit (`src/index.js`), pemisahan `core/` (infrastruktur pesan), `commands/` (alur UI), `services/` (logika konversi & persistence), `utils/`, dan error boundary terpusat (`MessageHandler.#run` + `BotError`). Encapsulation disiplin (private `#fields` hampir konsisten). Ini **bukan** proyek spaghetti.

### Kematangan engineering saat ini
**"Good enough for its intended purpose"** (bot personal/kelompok kecil di VPS sendiri) — **tetapi belum production-grade**. Ciri khasnya: pola desain baik di permukaan, namun lapisan data dan operasional (logging, persistensi, kebersihan repositori, pinning dependensi) menyimpan teknis-debt yang cukup serius.

### Lima risiko/kelemahan paling signifikan
1. **[P0] Kebocoran data pribadi pihak ketiga ke dalam repositori/log** — `runtime-logs.txt` (18 MB) berisi nomor HP asli + isi pesan pengguna grup, tidak di-gitignore, tanpa rotasi, dan `LOG_LEVEL=debug` aktif permanen di `.env`.
2. **[P0] Dependensi inti `@whiskeysockets/baileys` memakai `"latest"`** (package.json:17) — build tidak reproducible; versi rc bisa berubah sembarang saat `npm install` di VPS.
3. **[P1] Logging sinkron (`fs.appendFileSync`) pada hot path** (`src/core/Logger.js:158-161`) — setiap pesan menulis file berkali-kali secara blocking, file log tanpa rotasi.
4. **[P1] Auto-forward View-Once melewati kebijakan akses grup** (`src/core/MessageHandler.js:164-171` dieksekusi sebelum gate `isRestrictedGroup` di baris 201-205) — media view-once tetap diteruskan dari grup yang sengaja di-`.bot disallow`, sementara cache `.avo` justru dinonaktifkan untuk grup yang sama (inkonsisten).
5. **[P1] Tidak ada verifikasi ukuran buffer setelah unduhan media** (`src/core/MediaDownloader.js`) — hanya metadata `fileLength` yang dicek sebelum unduh; buffer penuh dimuat ke memori tanpa cek pasca-unduh (risiko media-bomb/DoS dari pesan forged).

### Rekomendasi umum
**Pertahankan arsitektur saat ini** (composition root + layering sudah tepat untuk skala ini), lalu lakukan perbaikan **incremental** pada lapisan data/operasional. Tidak perlu rewrite. Jangan tambahkan framework/abstraksi baru; fokus pada: hygiene data & log, pinning dependensi, konsistensi kebijakan akses, pembersihan dead code & format persistensi ganda, dan menutup gap pengujian pada jalur kegagalan.

---

## 2. IKHTISAR PROYEK

### Technology stack
| Komponen | Nilai | Catatan |
|---|---|---|
| Bahasa | JavaScript (ESM, `"type": "module"`) | Tanpa TypeScript; tanpa JSDoc tipe yang konsisten |
| Runtime | Node.js >= 20 (diaudit di v22.15.1) | Sesuai kebutuhan Baileys v7 |
| Library inti | `@whiskeysockets/baileys` **"latest"** (lockfile: 7.0.0-rc14) | ⚠️ tidak dipatok di package.json |
| Media | `sharp` ^0.34.0, `ffmpeg-static` ^5.2.0, `node-webpmux` ^3.2.0 | Untuk konversi sticker/EXIF |
| Logger | `pino` ^9.0.0 — **hanya** untuk membungkam logger internal Baileys (`src/core/baileysLogger.js:3`) | Logger aplikasi pakai `Logger` custom |
| Config | `dotenv` ^16.4.5 | |
| Test | `node:test` bawaan (tanpa coverage tool) | `npm test` = `node --test` |
| CI/Lint | **Tidak ada** (tidak ditemukan `.github/`, eslint, prettier, Dockerfile) | |

### Entry point & alur bootstrap
- `src/index.js:195-229` → `main()`: buat `Logger`, `buildApplication()` (composition root, baris 52-193), pasang signal handler (`SIGINT`/`SIGTERM`/`unhandledRejection`/`uncaughtException`), lalu `bot.start()`.
- `src/core/BotClient.js:37-80` → socket Baileys + event `messages.upsert` → `MessageHandler.handle()`.
- `src/core/MessageHandler.js:33-51` → filter `type === 'notify'`, limit konkurensi via `Semaphore(5)`, dispatch ke `#process()`.

### Struktur repositori (faktual, bukan asumsi)
```
src/
├─ index.js                # composition root (DI) — bersih
├─ config.js               # konfigurasi ter-frozen (Object.freeze)
├─ core/                   # BotClient, MessageHandler, MessageContext (Facade),
│                          # MessageExtractor, MediaDownloader, MessageSender,
│                          # CommandParser, CommandRegistry, OwnerPolicy,
│                          # PairingAuthenticator, Logger, baileysLogger
├─ commands/               # 12 command, 1 class per command + BaseCommand
├─ services/               # StickerFactory, MediaConverter, FfmpegService,
│                          # ImageService, StickerExifService, JsonStore,
│                          # GroupSettings, ViewOnceCache, ViewOnceForwarder,
│                          # SystemInfoService, ProviderInfoService, PingReportFormatter
├─ utils/                  # Semaphore, withTempDir, StickerMetaParser,
│                          # textSvgGenerator, formatters
└─ errors/BotError.js
data/                      # DATA_DIR default: groups.json, antiviewonce.json (+alias lama)
datas/                     # ⚠️ direktori legacy TAK TERPAKAI (tidak ada di alias index.js)
runtime-logs.txt (18 MB)   # ⚠️ log runtime berisi konten chat asli
errors.txt                 # stack trace + path server
antiviewonce.json / antiviewonce,json / viewonce.json (root)  # ⚠️ duplikat artefak alias
test/                      # 9 file node:test
```

### Dependensi runtime terkunci di lockfile (semua terpasang via lockfile, bukan node_modules lokal)
Baileys 7.0.0-rc14, dotenv 16.6.1, ffmpeg-static 5.3.0, node-webpmux 3.2.1, pino 9.14.0, sharp 0.34.5 — plus ~100 paket transitif (libsignal, protobufjs, ws, music-metadata, dll. dibawa Baileys).

---

## 3. PENILAIAN ARSITEKTUR

### Gaya arsitektur
Monolit single-process dengan **layering fungsional** + **composition root DI**. Pola yang benar-benar dipakai (bukan tempelan):
- **Facade**: `MessageContext` (src/core/MessageContext.js:9-182) menyatukan Extractor/Downloader/Sender.
- **Strategy**: `StickerCommand` (src/commands/StickerCommand.js:7-30) untuk 3 tipe media.
- **Registry + Template Method**: `CommandRegistry` + `BaseCommand`.
- **Inheritance 1 level yang sehat**: `GroupSettingCommand` → `CloseGcCommand`/`OpenGcCommand`.
- **LRU+TTL cache**: `ViewOnceCache`; **atomic write + write queue**: `JsonStore`; **Semaphore** untuk OOM/FFmpeg guard.

### Kekuatan arsitektur
1. **Composition root tunggal** (src/index.js:52-193): semua dependensi dirangkai di satu tempat, command menerima dependensi lewat constructor — DIP terpenuhi secara pragmatis; mudah di-mock (terbukti di test).
2. **Error boundary terpusat**: `MessageHandler.#run` (src/core/MessageHandler.js:210-231) memisahkan `BotError` (pesan aman untuk user) dari error internal (disembunyikan, dilog) — pola yang benar.
3. **Encapsulation disiplin**: private `#field` hampir di semua class; tidak ada global mutable state kecuali `config` (ter-`Object.freeze`).
4. **Resource hygiene**: `withTempDir` (src/utils/withTempDir.js) menjamin pembersihan file temp; `Semaphore` membatasi konkurensi FFmpeg (2) dan pesan (5); reconnect exponential backoff dengan cap 30s (src/core/BotClient.js:154).
5. **Resiliensi persistence**: `JsonStore` tulis atomik (tmp+rename), antrean tulis serial, cadangkan file korup ke `.corrupt-*` (src/services/JsonStore.js:62-108).

### Kelemahan arsitektur
1. **Lapisan persistensi berlapis workaround** (terbesar):
   - `ViewOnceForwarder` menyimpan **3 key redundan** (`targetJid`, `groupId`, `idGroup`) di setiap save (src/services/ViewOnceForwarder.js:251-258).
   - `GroupSettings.#persist` menulis **format baru (`accounts`) + format legacy top-level** sekaligus (src/services/GroupSettings.js:240-261).
   - `JsonStore` punya **5 alias file** yang ditulis SETIAP save (src/index.js:83-92 + src/services/JsonStore.js:99-108) — setiap `persist()` = **6 operasi tulis atomik**. Bukti nyata: file `antiviewonce.json`, `antiviewonce,json` (typo komma), `viewonce.json` di root, di `data/`, dan `datas/` (legacy yatim yang bahkan tidak masuk daftar alias).
   - Ini semua adalah shim migrasi tanpa mekanisme migrasi sekali-jalan. Seharusnya: migrasi data sekali saat init → satu file, satu format.
2. **Kebijakan akses terFragmentasi antar komponen**: gate grup/owner diimplementasi di 3 tempat dengan aturan berbeda — `MessageHandler.#process` (grup enable + owner), `AvoCommand` (owner internal sendiri + fallback fail-open), `GroupSettingCommand` (admin grup + owner). Auto-forward bahkan berjalan di luar semua gate (lihat §6). Tidak ada satu "policy engine".
3. **`Logger` mengetahui nama file log hardcoded** (`runtime-logs.txt`, `errors.txt` di src/core/Logger.js:71,133,158) dan menulis relatif CWD — konfigurasi tidak terpusat di `config.js`.
4. **`config.js` tidak lengkap**: `staleMessageSeconds` (120), `ping.*`, `viewOnceCache.*`, `video.background`, dan default pairing code `'TWEB-2126'` (src/config.js:25) hardcoded, tidak bisa dikonfigurasi via env.
5. **Tidak ada graceful shutdown untuk pekerjaan berat**: `shutdown()` keluar dalam 500ms (src/index.js:212-219) sementara FFmpeg bisa butuh sampai 90s — pekerjaan in-flight dipotong paksa (temp file tetap bersih berkat `withTempDir`, tapi UX-nya command gagal tanpa pesan).

### Aliran data & eksekusi (terlacak)
```
WhatsApp → Baileys socket → BotClient (#rememberMessages → store 1000 entri untuk retry)
  → MessageHandler.handle (Semaphore 5, queue tak terbatas)
  → #process: stale check (120s) → bindAccount → deteksi grup baru → [auto-forward AVO]
     → ViewOnceCache.remember (hanya grup aktif) → parse → resolve → [gate grup/owner]
     → command.execute → (download → ffmpeg/sharp → send) → error boundary
```

---

## 4. TINJAUAN KUALITAS KODE

### OOP & SOLID
- **SRP**: baik. `MediaDownloader` hanya unduh, `MessageSender` hanya kirim, `StickerMetaParser` hanya parse, `PingReportFormatter` murni format.
- **OCP/DIP**: baik pada command (semua dependensi di-inject). **Pelanggaran kecil**: `MediaConverter` membuat `ImageService` default sendiri (src/services/MediaConverter.js:15) — dua jalur pembuatan dependensi; `AvoCommand` punya fallback owner policy fail-open (src/commands/AvoCommand.js:31).
- **ISP/LSP**: tidak bermasalah untuk skala ini; `BaseCommand.execute` kontrak jelas.
- **KISS**: sebagian dilanggar — `AvoCommand.#handleSet` (src/commands/AvoCommand.js:74-163) memproses 9 sinonim aksi (`set/setgroup/setgrup/setid/...`) + 11 placeholder keyword + 3 layer regex pembersih, hanya untuk mengambil satu ID grup. `MessageHandler.syncGroups` (src/core/MessageHandler.js:71-88) mem-parsing array/string/object/entry-map secara defensif berlebih padahal Baileys selalu mengembalikan object map.

### DRY
- `BotCommand.#groupName` (src/commands/BotCommand.js:157-160) **duplikat** `GroupSettings.getGroupName` (src/services/GroupSettings.js:128-130) yang tidak pernah dipakai di src.
- Resolusi nama grup di `AvoCommand` (src/commands/AvoCommand.js:141-151 dan 179-189) menyalin logika yang sama dua kali lagi.
- `AvoCommand.#handleSet` dan `ViewOnceForwarder.sanitizeTargetJid` keduanya melakukan strip `[[<"'(]` + append `@g.us` (src/commands/AvoCommand.js:88-110 vs src/services/ViewOnceForwarder.js:5-10) — validasi JID tersebar di 2 layer.

### Dead code (terkonfirmasi via grep seluruh `src/` + `test/`)
| Lokasi | Item | Status |
|---|---|---|
| src/services/MediaConverter.js:48-62 | `webpToMp4()` — tidak pernah dipanggil (ToVideo memakai `animatedWebpToMp4`) | Dead method |
| src/core/CommandRegistry.js:20-22 | `all()` — tidak pernah dipanggil di src maupun test | Dead method |
| src/services/GroupSettings.js:128-130, 209-216 | `getGroupName()`, `overrides()`, `hasOverride()` — tidak dipakai src (hasOverride hanya di test) | Dead/duplikat |
| src/commands/ToVideoCommand.js:10 | Parameter constructor `images` diterima tapi tidak pernah dipakai | Dead param |
| src/commands/MenuCommand.js:232-233 | Menu mengiklankan **`.bot join [link]`** — tidak ada aksi `join` di `BotCommand.execute` (src/commands/BotCommand.js:24-42) | **Fitur hantu di UI** |
| README.md:7 | Mengatakan video "maks 10 dtk" — `config.sticker.maxSeconds = 7` (src/config.js:52) | Dokumentasi drift |
| README.md:3 | "3 fitur saja" — faktual ada 12 command | Dokumentasi drift |
| datas/ | Direktori data legacy, tidak dirujuk kode mana pun | Artefak yatim |

### Code smells lain
- **Magic numbers** tersebar: `8 * 1024 * 1024` foto profil (src/core/MessageContext.js:102), `MAX_STORED_MESSAGES = 500` (BotClient.js:11), `LIST_CHUNK_SIZE = 35` (BotCommand.js:5), `maxHistory = 1000` (ViewOnceForwarder.js:54), threshold `duration > 5` (StickerFactory.js:56). Tidak fatal tapi tidak terpusat.
- **Inkonsistensi kecil**: `SmemeCommand`/`BratCommand` menerima `prefix = '.'` default sedangkan command lain wajib menerima prefix; beberapa help memakai `\``, beberapa `*...*`.
- **Banner hardcoded** (src/core/Logger.js:108-124): nama bot & daftar command diketik manual — akan drift saat command berubah (sudah terjadi: banner menyebut `ping/bot/avo` tapi tidak `smeme/brat/getpp`).
- **`index.js:53`**: hanya `config.prefixes[0]` yang diberikan ke command untuk help text — multi-prefix dikonfigurasi tapi UI hanya menunjukkan satu.

---

## 5. PENILAIAN PERFORMA

### Karakteristik performa saat ini
Untuk bot personal: memadai. Semaphore pesan (5) + FFmpeg (2) + `maxBuffer` FFmpeg 16MB + timeout 90s adalah guard yang masuk akal. `encodeWithinLimit` (StickerFactory.js:52-69) menurunkan kualitas bertahap — worst case 4 pass FFmpeg per video panjang (±90s per pass) — trade-off yang dijelaskan di kode dan dapat diterima.

### Masalah performa terkonfirmasi
1. **[P1] I/O sinkron pada hot path — `Logger`** (src/core/Logger.js:158-161):
   - `#append` memakai `fs.appendFileSync` untuk **setiap** baris log, termasuk `debug`.
   - `.env` mengaktifkan `LOG_LEVEL=debug` (dua entri duplikat `LOG_LEVEL` ada di file .env).
   - Dari log aktual: **satu pesan teks biasa menghasilkan ±7 baris log** (upsert → menerima → pesan masuk → kebijakan → cache → bukan command). Artinya ≥7 × `appendFileSync` per pesan, **blocking event loop**, padahal event loop juga menangani socket TLS Baileys dan FFmpeg orchestration.
   - Bukti dampak: `runtime-logs.txt` = **18 MB dalam ±10 hari** aktif, tanpa rotasi, tanpa batas ukuran.
2. **[P2] Write amplification pada persistensi**: setiap `GroupSettings.rememberGroup/setEnabled/...` dan setiap save `ViewOnceForwarder` menulis 6 file atomik (1 primary + 5 alias) dengan JSON.stringify penuh (lihat §3). Saat grup baru terdeteksi di chat ramai, ini bisa terjadi berkali-kali berturut-turut.
3. **[P3] `SystemInfoService` polling `os.cpus()` setiap 500ms selamanya** (src/services/SystemInfoService.js:15-20) meskipun `.ping` tidak pernah dipakai (unref'd, kecil, tapi selalu ada).
4. **[P3] `fetchLatestBaileysVersion()` dipanggil ulang pada SETIAP reconnect** (src/core/BotClient.js:106-115) — network call tambahan saat koneksi flaky (saat paling tidak ideal). Sebaiknya di-cache.

### Potensi bottleneck (probable, belum diukur)
- **Antrean `Semaphore` tak terbatas** (src/core/MessageHandler.js:45-50): lonjakan 10 ribu pesan = 10 ribu objek pesan di memori menunggu slot (diluar store 1000 pesan di BotClient). Tidak ada backpressure.
- **Tidak ada rate-limit per pengirim**: satu user bisa membanjiri `.s` dan menghabiskan slot FFmpeg (2) sehingga user lain menunggu.

### Optimasi teoretis (tidak wajib)
- `groups()` menyalin + mengurutkan array setiap panggilan (GroupSettings.js:120-122) — di beberapa jalur per pesan; tidak signifikan untuk <200 grup.
- `hasViewOnceWrapper` memakai `WRAPPER_KEYS.includes(key)` di loop (MessageExtractor.js:37) — O(n) kecil; `Set` lebih tepat; dampak dapat diabaikan.

---

## 6. PENILAIAN KEAMANAN & RELIABILITAS

### Temuan keamanan (dengan skenario serangan)

**S1. [P0] Kebocoran data pribadi pihak ketiga ke file repositori**
- **Bukti**: `runtime-logs.txt` (18 MB) berisi pesan asli pengguna grup + nomor HP (diverifikasi sampling tail log: nomor telepon asli dan isi percakapan tampil). `errors.txt` memuat stack trace dengan path server. `data/groups.json` (17 KB) memuat daftar JID + nama grup. `.gitignore` (1-3) hanya berisi `node_modules/`, `session/`, `.env` — **tidak** mencakup `data/`, `datas/`, `runtime-logs.txt`, `errors.txt`, `*.json` data.
- **Skenario**: repo di-zip/push/share sebagai "backup" (nama folder sendiri: `BACKUPVPS`) → seluruh konten chat pribadi pengguna grup ikut terbawa. Debug log juga menulis preview teks pesan (MessageHandler.js:136-143).
- **Rekomendasi**: (a) tambahkan ke `.gitignore`: `data/`, `datas/`, `runtime-logs.txt`, `errors.txt`, `*.corrupt-*`, `session/`; (b) redact nomor telepon di log; (c) rotasi/ukuran maks log; (d) hapus artefak lama dari distribusi.

**S2. [P0] Dependensi `@whiskeysockets/baileys: "latest"`** (package.json:17)
- **Skenario**: `npm install` di VPS baru mengambil rc version berbeda → perubahan perilaku/breaking change diam-diam; juga risiko supply-chain tanpa pin. `requirements.txt:12` sendiri mengakui: *"package.json: 'latest'"*.
- **Rekomendasi**: pin exact `7.0.0-rc14` (sesuai lockfile) di package.json; commit lockfile (sudah ada); pertimbangkan `npm ci` di deployment.

**S3. [P1] Media bomb / tidak ada verifikasi pasca-unduh** (src/core/MediaDownloader.js:19-42)
- Hanya `media.node.fileLength` (metadata dari pengirim, bisa dipalsukan) yang dicek sebelum unduh; hasil `downloadMediaMessage` buffer penuh **tidak** dicek panjangnya. Pesan forged dengan `fileLength` kecil tapi payload besar bisa menghabiskan memori (batas WA media ±ratusan MB), ×5 konkurensi.
- Pola sama (cek setelah unduh) ada di `MessageContext.profilePicture` (MessageContext.js:101-102: cek 8MB **setelah** `arrayBuffer()` penuh).
- **Rekomendasi**: validasi `buffer.length > maxInputBytes` setelah unduh → buang dengan `BotError`; pertimbangkan streaming untuk media besar.

**S4. [P1] Auto-forward View-Once melewati kebijakan akses grup**
- `MessageHandler.#process` memanggil `forwarder.handleMessage` (baris 164-171) **sebelum** gate `isRestrictedGroup` (baris 201-205), dan `handleMessage` hanya mengecek `fromMe` (ViewOnceForwarder.js:128). Media view-once dari grup yang di-`.bot disallow` / mode `privateOnly` **tetap diteruskan** ke grup target.
- Inkonsisten: baris 174-178 justru menonaktifkan `ViewOnceCache.remember` untuk grup nonaktif — sehingga `.avo` manual ditolak di grup yang sama sementara auto-forward jalan.
- **Rekomendasi**: putuskan satu kebijakan (disarankan: hormati flag grup; atau minimal dokumentasikan perilaku bypass secara eksplisit) dan konsistenkan cache vs forwarder.

**S5. [P1] `uncaughtException` hanya di-log, proses lanjut** (src/index.js:220-221)
- Setelah uncaught exception, state Node/baileys bisa korup; melanjutkan proses adalah anti-pattern yang bisa menghasilkan perilaku tak terduga (mis. socket setengah mati).
- **Rekomendasi**: log → flush log → `process.exit(1)` (dengan restart supervisor seperti PM2/systemd; README memang menyebut PM2/Docker di README.md:38 tapi tidak menyediakan konfigurasinya).

**S6. [P2] `.env.example` berisi nilai personal nyata** — `OWNER_NUMBERS=62***` dan `PAIRING_CODE=TWEB-2126` (.env.example:12,19). File contoh biasanya di-commit → PII owner terekspos. Juga `.env` lokal memiliki **key duplikat** (`FFMPEG_PATH`, `LOG_LEVEL` muncul 2×) — indikasi hygiene config buruk. Selain itu default `pairingCode` hardcoded di source (config.js:25).
- **Rekomendasi**: kosongkan nilai di `.env.example`; hapus duplikat key; default pairing code sebaiknya di-generate acak saat boot.

**S7. [P2] Fallback owner fail-open** (src/commands/AvoCommand.js:31): jika `owners` lupa di-pass saat registrasi, `.avo set` hanya dijaga `ctx.fromMe` — masih aman-ish, tapi pola fail-open lebih baik diganti fail-fast (throw di constructor bila dependensi owner wajib tidak ada).

**S8. [P3] Privasi fitur**: caption auto-forward menyertakan nama + nomor HP pengirim (ViewOnceForwarder.js:240); `.ping` mengirim IP publik server ke 2 layanan pihak ketiga (ProviderInfoService.js:4-23, satu via **HTTP plaintext**) — sudah dimask di tampilan (formatters.js:32-38, baik), tapi permintaan HTTP polos tetap menyebarkan UA/IP ke jaringan lokal. `getpp` publik = siapa pun bisa minta foto profil user yang di-mention (fitur, bukan bug — namun layak jadi pilihan config).

### Reliabilitas
- **Baik**: reconnect backoff ber-caps (BotClient.js:154-163), `JsonStore` tahan file korup/kosong, dedupe forward (`forwardedIds`/`inflight`), `staleMessageSeconds` mencegah replay command lama, `renameWithRetry` untuk Windows lock.
- **Celah**:
  - Tidak ada retry/backoff untuk unduhan media — bukti `errors.txt` (26 Okt): `ENOTFOUND a.whatsapp.net` (DNS) → user langsung dapat error, padahal transient.
  - Dedupe forward hanya in-memory (ViewOnceForwarder.js:50) → setelah restart, pesan re-delivered bisa ter-forward dua kali.
  - Logout → `process.exit(1)` (BotClient.js:151) tanpa cleanup — dapat diterima, tapi tanpa supervisor = bot mati sampai ada yang nyalakan.
  - Tidak ada graceful shutdown untuk FFmpeg in-flight (lihat §3.5).
  - Log tanpa rotasi = disk penuh dalam skala bulan (18MB/10 hari).

---

## 7. DEPENDENSI & TEKNOLOGI

| Paket | Versi (lockfile) | Verdict | Alasan |
|---|---|---|---|
| `@whiskeysockets/baileys` | 7.0.0-rc14, **"latest" di package.json** | **Pertahankan tapi PIN** | inti; rc version wajib dipatok; perubahan rc bisa merusak pairing/media |
| `sharp` | 0.34.5 | Pertahankan | standar de-facto image processing, native & cepat |
| `ffmpeg-static` | 5.3.0 | Pertahankan | menyederhanakan deploy; `FFMPEG_PATH` override sudah ada |
| `node-webpmux` | 3.2.1 | Pertahankan | satu-satunya cara praktis embed EXIF webp |
| `pino` | 9.14.0 | **Kandidat diganti shim kecil** | hanya dipakai untuk `level: 'silent'` (src/core/baileysLogger.js) — logger no-op 5 baris menghilangkan ±15 paket transitif (pino-*, sonic-boom, thread-stream, dll). Trade-off: kehilangan kompatibilitas jika suatu saat ingin surface log Baileys |
| `dotenv` | 16.6.1 | Pertahankan | standar |
| `music-metadata`, `whatsapp-rust-bridge`, dll. | transitif (dibawa Baileys) | Tidak dapat ditindak | out of control |

- **Tidak ada dependensi dev** (eslint/prettier/c8/tsx) — lihat §8 & §10 DX.
- **`requirements.txt`**: file gaya-Python untuk proyek npm — redundan dengan package.json dan berpotensi menyesatkan (format `node >= 20` bukan format pip). Sebaiknya dihapus atau diubah jadi bagian README.
- Versi Node lokal audit (22.15.1) ≥ engines (20) — kompatibel.

---

## 8. TESTING & QUALITY ASSURANCE

### Strategi saat ini
9 file `node:test` (~3.418 baris), pola **mock ctx/sock hand-crafted** (tidak ada mocking framework). Cakupan unit yang SUDAH baik:
- `Semaphore` (invalid max, bound, release on error) — p0_bugfixes.test.js:122-164
- `ViewOnceCache` (evict expired, LRU bound) — p0:32-68
- `JsonStore` (save/load/corrupt) — p1_protocol:45-63
- `ProviderInfoService` (prewarm, inflight dedupe) — p1:65-129
- `MessageExtractor`/`hasViewOnceWrapper` — p1:131-163, debug_logging:52-110
- `ViewOnceForwarder` (persist, forward image/video/audio, dedupe, fromMe, fail download) — p3 (sangat menyeluruh)
- `GroupSettings` (sync/prune/override/multi-account) — p4 (menyeluruh)
- `MessageHandler` integration (menu dispatch, policy) — menu_command:161+, group_admin_and_owner
- `GroupSettingCommand` (bot non-admin, caller member) — group_admin_and_owner
- Pipeline nyata FFmpeg+sharp (`animatedWebpToMp4` → cek magic bytes `ftyp`) — p2:93-153
- SVG utils — smeme_and_brat

### Gap pengujian (critical untested behavior)
1. **`MediaDownloader`** — tidak ada test sama sekali: penolakan ukuran (fileLength > max), pembungkusan error → `BotError`. Ini persis area yang berlubang keamanan (S3).
2. **`BotClient`** — hanya `stop()` yang diuji (p0:109-120). Reconnect backoff, dedupe pairing `#requested`, `#rememberMessages` eviction, `getMessage` — tidak diuji.
3. **`Logger`** — tidak ada test untuk penulisan file, rotasi (tidak ada), format error/cause chain.
4. **`StickerFactory.#encodeWithinLimit`** — loop degradasi kualitas + throw bila semua gagal: tidak diuji.
5. **`CommandParser`** — hanya teruji tidak langsung via integration (multi-prefix sort, `\S+` edge, name lowercase).
6. **`PairingAuthenticator`** — hanya validasi kode; loop prompt invalid (infinite), non-interactive guard — tidak diuji.
7. **Gate kebijakan** — kombinasi `privateOnly` + owner + alwaysAvailable: tercakup sebagian; **jalur auto-forward vs grup disabled (S4) tidak teruji** — padahal itulah bug kebijakannya.
8. **`OwnerPolicy`** LID/`participantAlt` matrix — teruji sebagian via menu/group admin tests.
9. Tidak ada **coverage measurement** (c8/nyc tidak ada), tidak ada CI, tidak ada lint → regresi gaya/logika hanya tertangkap manual.

### Kualitas test
- Positif: deterministik (fake `now`, tmpdir unik), menjalankan integrasi FFmpeg nyata (berat tapi bernilai), assertion spesifik.
- Negatif: sleep-based synchronization (`setTimeout(50)`, menu_command.test.js:223,248) — rapuh di CI lambat; mutasi `process.env.LOG_LEVEL` global dengan restore manual (debug_logging.test.js:45-49); test p0:167 punya variabel import tak terpakai.

### Rekomendasi QA pragmatis
1. Tambah test `MediaDownloader` (ukuran ditolak, error dibungkus) — paling murah, paling bernilai.
2. Tambah test kebijakan: pesan view-once di grup disabled → apa yang terjadi (mengunci perilaku S4).
3. Tambah test `BotClient` reconnect: simulasi `connection.close` berulang → assert delay 1-2-4...30s dan stop() membatalkan.
4. Tambah test `StickerFactory` limit-loop dengan fake converter.
5. Ganti sleep dengan fake timer/`t.mock` atau abaikan — minor.
6. Pasang `c8` untuk coverage + `eslint` (flat config) minimal rule: no-unused-vars, eqeqeq.

---

## 9. TEMUAN TERSTRUKTUR & REKOMENDASI (untuk dieksekusi AI)

### 9.1 Tabel prioritas

| Prio | Kategori | Temuan | Lokasi | Rekomendasi | Kompleksitas |
|---|---|---|---|---|---|
| P0 | Keamanan/Privasi | Log runtime 18MB berisi konten chat + nomor HP pihak ketiga, tanpa rotasi, tidak di-gitignore | `runtime-logs.txt`, `.gitignore:1-3`, `Logger.js:126-161` | Gitignore data/log; redact nomor; rotasi/ukuran maks; matikan LOG_LEVEL=debug default produksi | Kecil |
| P0 | Dependensi | Baileys `"latest"` tidak dipatok | `package.json:17` | Pin `7.0.0-rc14` exact | Trivial |
| P1 | Performa | `appendFileSync` per baris log pada hot path | `src/core/Logger.js:158-161` | Tulis async ter-batch/debounced; batas ukuran + rotasi; pertimbangkan pino ke file | Sedang |
| P1 | Keamanan | Tidak ada cek ukuran buffer pasca-unduh media | `src/core/MediaDownloader.js:24-38`; `MessageContext.js:101-102` | Validasi `buffer.length` setelah unduh; tolak dengan BotError | Kecil |
| P1 | Keamanan/Kebijakan | Auto-forward AVO bypass gate grup disabled/privateOnly; cache `.avo` justru off untuk grup sama | `MessageHandler.js:164-178,201-205`; `ViewOnceForwarder.js:126-131` | Samakan kebijakan (hormati grup disabled) + test pengunci | Kecil-Sedang |
| P1 | Reliabilitas | `uncaughtException`/`unhandledRejection` hanya di-log, proses lanjut | `src/index.js:220-221` | Log → exit(1) + dokumentasikan supervisor (PM2/systemd) | Kecil |
| P1 | Keamanan | `.env.example` berisi OWNER_NUMBERS & PAIRING_CODE nyata; `.env` punya key duplikat; default pairing code hardcoded | `.env.example:12,19`; `.env`; `config.js:25` | Sanitasi example; bersihkan .env; generate kode acak saat boot | Trivial |
| P2 | UX/Kebenaran | Menu mengiklankan `.bot join [link]` yang tidak diimplementasi | `MenuCommand.js:232-233` vs `BotCommand.js:24-42` | Implementasi `join` (pakai `sock.groupAcceptInvite`) ATAU hapus dari menu | Kecil |
| P2 | Dokumentasi | README drift: "maks 10 dtk" vs config 7s; "3 fitur" vs 12 command; banner command list usang | `README.md:3,7`; `Logger.js:120-121` | Sinkronkan; render daftar command dari registry | Kecil |
| P2 | Arsitektur data | Write amplification 6 file/save + format ganda + artefak typo (`antiviewonce,json`) + `datas/` yatim | `index.js:83-92`; `JsonStore.js:99-108`; `GroupSettings.js:240-261`; `ViewOnceForwarder.js:251-258` | Migrasi sekali-jalan ke 1 file/1 format di `init()`; hapus alias & key redundan setelah migrasi; hapus `datas/` | Sedang |
| P2 | Keandalan | Antrean pesan tak terbatas; tanpa rate-limit per pengirim | `MessageHandler.js:45-50` | Batas antrean (drop + warn saat penuh); throttle per JID pengirim | Sedang |
| P2 | Reliabilitas | Unduhan media tanpa retry utk error transient (DNS/time-out) | `MediaDownloader.js:39-42`; bukti `errors.txt` | Retry 1-2× backoff pendek utk error jaringan sebelum gagalkan command | Kecil |
| P2 | Reliabilitas | Dedupe forward in-memory hilang saat restart → forward ganda | `ViewOnceForwarder.js:50,157-163` | Simpan `forwardedIds` ring buffer ke JsonStore (sudah ada store) | Kecil |
| P2 | Kebersihan | Dead code: `webpToMp4`, `CommandRegistry.all`, `getGroupName/overrides/hasOverride`, param `images` ToVideoCommand | `MediaConverter.js:48-62`; `CommandRegistry.js:20-22`; `GroupSettings.js:128-130,209-216`; `ToVideoCommand.js:10` | Hapus (atau pakai: `BotCommand` pakai `getGroupName`) | Trivial |
| P2 | DRY | 3× duplikasi resolusi nama grup; validasi JID group tersebar | `BotCommand.js:157-160`; `AvoCommand.js:141-151,179-189`; `ViewOnceForwarder.js:5-10` | Satukan ke helper (`groups.getGroupName` + `utils/jid.js`) | Kecil |
| P2 | Tooling | Tanpa lint/format/coverage/CI | repo root | Tambah eslint flat-config + c8 + GitHub Actions sederhana (`npm ci && npm test`) | Sedang |
| P3 | Keamanan | Fallback owner fail-open di AvoCommand | `AvoCommand.js:31` | Wajibkan `owners` (throw bila absen) | Trivial |
| P3 | KISS | Over-parsing argumen `.avo set` (9 sinonim, 11 placeholder, 3 regex) | `AvoCommand.js:42-115` | Sederhanakan: `set <jid|index|'ini'>` saja | Kecil |
| P3 | KISS | `syncGroups` parsing defensif berlebih | `MessageHandler.js:71-88` | Terima object map Baileys saja; sisakan 1 fallback | Kecil |
| P3 | Config | Nilai hardcoded: stale 120s, ping.*, viewOnceCache.*, video.background, banner | `config.js:30,39-48,67-70`; `Logger.js:108-124` | Pindah ke config/env bila relevan | Kecil |
| P3 | DX | Multi-prefix didukung parser tapi help/banner hanya pakai prefix pertama | `index.js:53` | Teruskan daftar prefix atau dokumentasikan | Trivial |
| P3 | Hygiene | `requirements.txt` menyesatkan (format Python utk proyek npm) | `requirements.txt` | Hapus / jadikan seksi README | Trivial |
| P3 | Test | Sleep-based sync; env mutation tanpa sandbox; import tak terpakai | `menu_command.test.js:223`; `debug_logging.test.js:45-49`; `p0_bugfixes.test.js:167` | Fake timer / tearDown; hapus | Kecil |

### 9.2 Penjelasan temuan kunci (untuk konteks AI perbaikan)

**F-1 (P0, log & privasi).** `Logger.#write` menulis ke console **dan** `runtime-logs.txt` untuk semua level; `Logger.error` juga menulis `errors.txt` (Logger.js:126-134, 68-72). Path di-`path.resolve(file)` relatif CWD. Dengan `LOG_LEVEL=debug` (aktif di .env produksi), setiap pesan masuk menghasilkan ±7 baris yang memuat: JID chat lengkap, nomor HP pengirim, preview teks pesan (47-50 karakter), dan status kebijakan. File tidak pernah dirotasi. **Perbaikan bertahap**: (1) `.gitignore` + hapus artefak; (2) di `MessageHandler.#process` redact nomor (mis. `628***43642`) sebelum log; (3) di `Logger.#append` cek ukuran file, rotasi ke `.1` saat > N MB; (4) jadikan debug off by default di produksi.

**F-2 (P1, kebijakan AVO).** Urutan di `#process`: `forwarder.handleMessage(ctx, sock)` (164-171) → `viewOnceCache.remember` dengan guard `groupEnabled && (!privateOnly || !isGroup)` (174-178) → gate command (201-205). Karena `handleMessage` tidak menerima konteks kebijakan sama sekali, satu-satunya guard adalah `ctx.fromMe`. **Perbaikan**: pass flag (mis. `handleMessage(ctx, sock, { allowed: groupEnabled && !(privateOnly && ctx.isGroup) })`) atau pindahkan pemanggilan forwarder ke blok yang sama dengan cache remember. Jangan lupa test regression.

**F-3 (P1, media bomb).** `MediaDownloader.download` memvalidasi `Number(media.node?.fileLength ?? 0) > this.#maxInputBytes` sebelum unduh — tapi `fileLength` berasal dari pengirim. Setelah `downloadMediaMessage` selesai, `buffer` langsung dikembalikan. **Perbaikan minimal 3 baris**: `if (buffer.length > this.#maxInputBytes) throw new BotError(...)` setelah unduh (sebelum return). Untuk draf berikutnya: mode streaming Baileys + batas akumulasi.

**F-4 (P2, persistensi).** State saat ini membuat 6 salinan `antiviewonce` (root ×3 termasuk file typo `.json`→`,json`, `data/` ×2, ditambah `datas/` yang sudah tidak dibaca) dan menyimpan format lama+baru bersamaan di groups.json dan antiviewonce.json. **Perbaikan**: di `init()`, jika ada file alias berisi data valid → baca, tulis ke primary, hapus alias (log keputusan); setelah itu constructor tanpa `aliases`. Simpan hanya `targetJid` (buat `updatedAt`), dan di GroupSettings hanya blok `accounts` + `policyVersion`.

---

## 10. SKOR KEMATANGAN ENGINEERING

| Dimensi | Skor /10 | Bukti & justifikasi |
|---|---|---|
| Arsitektur & desain | **7.5** | Composition root DI (index.js:52-193), layering jelas, Facade/Strategy/Registry dipakai tepat; minus: policy engine terfragmentasi (3 lokasi), lapisan persistensi berbasis workaround |
| Kualitas kode | **7** | Konsisten, encapsulation disiplin (`#field`), penamaan baik, komentar berbahasa Indonesia fungsional; minus: dead code terkonfirmasi (5 item), magic numbers, KISS dilanggar di AvoCommand/syncGroups |
| OOP & SOLID | **7** | SRP kuat di services/core; DIP nyata via constructor injection; pelanggaran kecil: default dependensi dalam constructor (MediaConverter.js:15, AvoCommand.js:31) |
| Maintainability | **6.5** | Struktur mudah dinavigasi, command mudah ditambah (sesuai README); minus: migrasi data manual, dokumentasi drift (README vs config), banner hardcoded |
| Performa | **6** | Guard konkurensi memadai; minus terkonfirmasi: sync file I/O di hot path, write amplification 6 file/save, tanpa rotasi log (18MB/10 hari) |
| Keamanan | **5.5** | Owner gating + validasi JID + mask IP ada; minus: PII di log/repo, media-bomb gap, bypass kebijakan AVO, `.env.example` berisi data nyata, `"latest"` |
| Reliabilitas | **6.5** | Reconnect backoff, atomic write, dedupe, stale filter; minus: uncaughtException dilanjutkan, tanpa retry unduhan, dedupe hilang saat restart, tanpa graceful heavy-shutdown |
| Testing | **6.5** | 9 file test bermakna, pola mock disiplin, 1 integration FFmpeg nyata; minus: MediaDownloader/BotClient/Logger/encode-limit tanpa test, sleep-based, tanpa coverage/CI |
| Manajemen dependensi | **5** | Lockfile sehat dan lengkap, stack ramping; tapi `"latest"` untuk paket paling kritis = reproducibility buruk; pino dipakai hanya sebagai stub |
| Scalability | **6** | Untuk 1 akun & puluhan grup cukup; antrean tak terbatas & tanpa per-user throttle membatasi lonjakan; multi-akun sudah dipikirkan (GroupSettings.bindAccount) — positif |
| Dokumentasi | **6** | README praktis (setup, pairing, struktur); minus: drift angka/fitur, tidak ada CONTRIBUTING/CHANGELOG, `requirements.txt` menyesatkan |
| Developer experience | **6** | `npm start/dev/test` jelas, ESM modern, debug logging kaya; minus: tanpa lint/format/CI/Docker (README menjanjikan skenario PM2/Docker tanpa contoh) |
| **Keseluruhan** | **6.3** | Fondasi engineering di atas rata-rata untuk kelasnya; blok penghalang production-grade ada di kebersihan data/log, pinning, dan konsistensi kebijakan |

### Positioning (perbedaan istilah)
- **Good enough for intended purpose**: ✅ YA — bot personal/kelompok kecil berjalan stabil (bukti log uptime normal).
- **Production-ready**: ⚠️ HAMPIR — butuh P0 (privasi log + pinning) dan P1 kebijakan/DoS dulu.
- **Production-grade**: ❌ BELUM — tanpa CI, observability terbatas (log file bukan metrics), tanpa rotasi, tanpa supervisor terdokumentasi.
- **Enterprise-ready**: ❌ TIDAK — dan **tidak perlu** dituntut untuk proyek ini; jangan menambah infrastruktur enterprise pada bot personal.

---

## 11. ROADMAP PERBAIKAN (urutan eksekusi yang disarankan)

### Phase A — Perbaikan kritikal (harus dulu; ±1 sesi kerja)
1. Pin `@whiskeysockets/baileys` ke `7.0.0-rc14` di `package.json` (P0).
2. `.gitignore`: `data/`, `datas/`, `runtime-logs.txt`, `errors.txt`, `antiviewonce*.json*`, `viewonce.json`, `*.corrupt-*`; bersihkan artefak dari distribusi/backup (P0).
3. Sanitasi `.env.example`; hapus duplikat key `.env` (P1).
4. Cek `buffer.length` pasca-unduh di `MediaDownloader` + `profilePicture` (P1, ~5 baris).
5. `uncaughtException`/`unhandledRejection` → log + `process.exit(1)`; dokumentasikan PM2/systemd (P1).

### Phase B — Struktural
6. Konsistensi kebijakan AVO vs grup disabled/privateOnly (+ regression test) (P1).
7. Migrasi persistensi sekali-jalan: 1 file `data/*.json`, 1 format; hapus alias & key redundan; hapus `datas/` (P2).
8. Logger async + rotasi + redaksi nomor + debug default off (P1, gabung dengan A.2 bila sekalian).

### Phase C — Kualitas kode
9. Hapus dead code (`webpToMp4`, `all()`, `getGroupName`/`overrides`/`hasOverride` — atau pakai `getGroupName` di BotCommand/AvoCommand), param `images` ToVideoCommand (P2).
10. Satukan helper nama grup + validasi JID grup (P2); sederhanakan parsing `.avo set` dan `syncGroups` (P3).
11. Sinkronkan README/banner dengan perilaku aktual; putuskan `.bot join`: implement atau hapus (P2).

### Phase D — Performa
12. Batas antrean pesan + rate-limit ringan per pengirim (P2).
13. Cache `fetchLatestBaileysVersion` antar reconnect (P3); jadikan sampling CPU lazily-start saat `.ping` pertama (P3).

### Phase E — Testing, keamanan, reliabilitas
14. Test `MediaDownloader` (ukuran/error) — segera setelah F-3 diperbaiki.
15. Test kebijakan (AVO × grup disabled; privateOnly × owner × alwaysAvailable).
16. Test `BotClient` reconnect & `StickerFactory` limit loop; retry transient unduhan; persist dedupe forward (P2).
17. Tambah eslint + c8 + CI sederhana (P2).

### Phase F — Jangka panjang
18. Evaluasi penggantian `Logger` custom dengan pino yang sudah ada (satu transport file berotasi) — hanya jika Phase B.8 dianggap belum cukup.
19. Jika fitur berkembang: pertimbangkan TypeScript/JSDoc-check bertahap mulai dari `core/`.
20. Dokumentasikan arsitektur keputusan (ADR ringkas) untuk: kebijakan akses, format persistensi, kebijakan log.

**Dependensi antar langkah**: A.1/A.2 sebelum apa pun yang menyentuh data; B.6 sebelum E.15 (test mengunci kebijakan); B.7 sebelum E.16-dedupe (dedupe butuh store final); C.9 sebelum C.10 (helper menyerap penggunaan dead method).

---

## 12. VERDICT ENGINEERING (jawaban langsung)

1. **Apakah arsitektur saat ini sesuai untuk proyek ini?** — **Ya.** Monolit berlapis + DI composition root adalah pilihan tepat untuk bot WhatsApp single-process; tidak ada indikasi perlu mikrokontroler arsitektur baru.
2. **Apakah codebase terstruktur dengan baik?** — **Ya, di atas rata-rata** untuk kelas bot Baileys; struktur folder mencerminkan tanggung jawab nyata (diverifikasi, bukan sekadar nama folder).
3. **Apakah mengikuti OOP/SOLID dengan baik?** — **Sebagian besar ya** (SRP/DIP kuat); pelanggaran kecil berupa default dependensi dalam constructor dan satu fallback fail-open.
4. **Apakah ada duplikasi kode berlebihan?** — **Tidak berlebihan**, tapi ada 3 duplikasi konkret resolusi nama grup + validasi JID ganda + format persistensi ganda.
5. **Apakah perlu refactoring signifikan?** — **Tidak perlu rewrite; perlu refactoring terarah** pada: kebijakan akses (satukan), persistensi (migrasi sekali-jalan), Logger (async+rotasi).
6. **Apakah implementasi dioptimalkan dengan tepat?** — **Cukup**, dengan 1 masalah terkonfirmasi (sync logging) dan 1 probable (write amplification); tidak ada indikasi premature optimization — justru guard konkurensinya dipikirkan.
7. **Apakah ada dependensi/teknologi yang tidak perlu?** — **pino** (dipakai sebagai stub silent logger saja), **`requirements.txt`** (redundan & menyesatkan); sisanya ramping dan tepat.
8. **Apa yang harus diganti dan mengapa?** — `"latest"` → pin exact (reproducibility); persistensi alias/kunci-ganda → satu format (kebenaran data); appendFileSync → async+rotasi (stabilitas event loop & disk); `.env.example` → kosong (privasi). **Tidak** perlu mengganti sharp/ffmpeg-static/webpmux.
9. **Apa yang harus dipertahankan?** — Composition root, error boundary + BotError, Semaphore + withTempDir, JsonStore atomic-write (minus alias), pola command registry, test suite yang ada (dan diperluas, bukan diganti).
10. **Perbaikan terpenting sebelum layak disebut production-ready?** — Phase A seluruhnya + B.6 (kebijakan AVO) + B.8 (log async/rotasi) + test MediaDownloader.
11. **Satu perbaikan paling bernilai?** — **Kebersihan log & data (F-1)**: satu perbaikan yang sekaligus menutup risiko privasi terbesar, risiko disk-full, dan beban event loop — dengan biaya implementasi kecil.

---

*Laporan ini dihasilkan dari inspeksi statis seluruh file sumber dan artefak yang tersedia pada tanggal audit. Klaim performa bersifat analitis (tidak ada benchmark runtime); klaim bug/keamanan masing-masing disertai lokasi dan skenario. Item yang tidak dapat dipastikan (mis. perilaku versi Baileys di masa depan) dinyatakan sebagai risiko, bukan fakta.*

---

## RIWAYAT PERBAIKAN (post-audit)

Perbaikan yang telah dieksekusi (referensi nomor = seksi laporan di atas):

| Temuan | Perbaikan |
|---|---|
| P0 Baileys `"latest"` | Dipatok exact `7.0.0-rc14` di `package.json` + root spec lockfile disinkronkan |
| P0/S1 PII di repo | `.gitignore` diperluas (data/, datas/, log, artefak); `.env.example` disanitasi; nomor owner di test diganti fixture fiksi; redaksi di report; **nomor di log kini di-redaksi otomatis** |
| P1 Sync logging | `Logger` ditulis ulang: buffer flush batch tiap 2s (async, tidak memblokir event loop), rotasi 10 MB, `Logger.shutdown()` saat SIGINT/SIGTERM/uncaughtException |
| P1/S3 Media bomb | `MediaDownloader` memverifikasi `buffer.length` pasca-unduh + retry 2× untuk error jaringan transient (bukti `errors.txt`: ENOTFOUND) |
| P1/S4 Bypass AVO | `MessageHandler`: cache & auto-forward kini memakai kebijakan akses yang sama (grup disabled/privateOnly tidak dicatat & tidak diteruskan) |
| P1/S5 uncaughtException | Log → flush log → `process.exit(1)` (jalankan via supervisor) |
| P2 dedupe forward | Riwayat `forwardedIds` dipersist ke store & dipulihkan saat init (dedupe lintas restart) |
| P2 write amplification | Alias JsonStore dihapus; format `GroupSettings` & `ViewOnceForwarder` disatukan (tanpa duplikat legacy/redundan) |
| P2 antrean tak terbatas | Backpressure `maxPending = 100` di `MessageHandler` |
| P2 menu `.bot join` | Diganti `.bot default on|off` (yang benar-benar ada); test menu disinkronkan |
| P2 README/banner drift | README: 7 detik (sesuai config), daftar 12 fitur; banner command usang dihapus; log command terdaftar saat boot |
| P3 dead code | `webpToMp4` dipakai test (dipertahankan), `all()` dipakai log boot, `getGroupName` dipakai BotCommand/AvoCommand, param `images` ToVideoCommand dihapus |
| P2/S6 pairing code | Fallback hardcoded `TWEB-2126` dihapus dari `config.js` → `null` (kode acak dari server / prompt interaktif); `.env.example` ditambah peringatan |
| P3 bindAccount | Dipanggil sekali per koneksi (via syncGroups saat 'open'), tidak lagi per pesan |
| P3 version fetch | `fetchLatestBaileysVersion` di-cache antar reconnect |
