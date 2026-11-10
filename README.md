# 🎛 FallingLight Media Controller — Web Edition

A web-based media controller for school public relations rooms. Runs on your machine via **Bun + ElysiaJS**, accessed from the AV room via browser.

**Stack:** Bun • ElysiaJS • TypeScript • TailwindCSS • HTML5 Audio API

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔐 **Login** | Cookie-based session auth (`admin` / `cptw@2468`) |
| 🎵 **Player** | Client-side audio playback with HTML5 Audio API |
| 📊 **VU Meters** | Real-time stereo levels via Web Audio API `AnalyserNode` |
| 🎚 **Fade/Duck** | Smooth volume fade-out, mic ducking with manual toggle |
| 📋 **Playlist** | Add, remove, reorder (drag & drop), per-track loop counts |
| 📅 **Scheduler** | One-time / Daily / Weekly automated playback |
| 📤📥 **Import/Export** | Scheduler configs as JSON files |
| 📁 **File Manager** | Upload, download, delete media files (drag & drop upload) |
| 🌏 **TH/EN** | Bilingual UI toggle |

---

## 🚀 Quick Start

```bash
# Install dependencies
bun install

# Start development server (auto-reload)
bun run dev

# Or start production server
bun run start
```

Server runs at **http://localhost:3000** and listens on **0.0.0.0** for LAN access.

### Access from AV Room
1. Find your machine's LAN IP: `ip addr` or `ipconfig`
2. Open on AV room PC: `http://<your-ip>:3000`
3. Login: `admin` / `cptw@2468`

---

## 📁 Project Structure

```
├── src/                    # ElysiaJS server (TypeScript)
│   ├── index.ts            # Entry point (port 3000, 0.0.0.0)
│   ├── routes/
│   │   ├── auth.ts         # POST /api/auth/login|logout, GET /check
│   │   ├── files.ts        # GET/POST/DELETE /api/files
│   │   └── scheduler.ts    # CRUD + import/export /api/scheduler
│   ├── middleware/
│   │   └── auth-guard.ts   # Session cookie validation
│   └── utils/
│       └── storage.ts      # File system + schedule persistence
│
├── public/                 # Static frontend
│   ├── index.html          # SPA (login + 3-tab app)
│   ├── js/
│   │   ├── audio-engine.js # HTML5 Audio + Web Audio API
│   │   ├── playlist.js     # Client-side playlist manager
│   │   ├── scheduler-ui.js # Schedule CRUD + timer
│   │   ├── i18n.js         # TH/EN language manager
│   │   └── app.js          # Auth, tabs, file manager
│   └── i18n/
│       ├── en.json
│       └── th.json
│
├── uploads/                # Media files (created at runtime)
├── data/                   # Persistent data
│   └── schedules.json      # Schedule persistence
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🎮 Usage

### Player Tab
- **Add File** — pick from uploaded files
- **Double-click** a track to play it
- **Drag & drop** rows to reorder
- **Loop count** — set per track (0 = infinite)
- **🎙 MIC/PR** — press to duck audio, press again to restore

### Schedule Tab
- Create **daily/weekly/one-time** schedules
- Schedules fire automatically when the browser is open
- **Export** schedules as JSON backup
- **Import** to restore or share schedules

### Files Tab
- **Upload** via button or drag & drop
- **Download** any uploaded file
- **Delete** files you no longer need
- **🎵** button adds file to playlist

---

## 📋 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with username/password |
| POST | `/api/auth/logout` | Clear session |
| GET | `/api/auth/check` | Check session validity |
| GET | `/api/files` | List uploaded files |
| POST | `/api/files/upload` | Upload file (multipart) |
| DELETE | `/api/files/:filename` | Delete a file |
| GET | `/api/scheduler` | List schedules |
| POST | `/api/scheduler` | Create schedule |
| PUT | `/api/scheduler/:id` | Update schedule |
| DELETE | `/api/scheduler/:id` | Delete schedule |
| PATCH | `/api/scheduler/:id/toggle` | Toggle enabled |
| GET | `/api/scheduler/export` | Export as JSON download |
| POST | `/api/scheduler/import` | Import from JSON file |

---

*Built with ❤ for school PR rooms — FallingLight v1.0.0 Web Edition*

---

## 🔎 YouTube Browser

Open **Files → Tools** to search YouTube for songs or videos, then press **MP3** or **MP4** on a result to download it into the selected folder. Several downloads can run at once and appear in the download queue.

- API: `GET /api/youtube/search?q=<text>&limit=12` (login required, query max 200 chars, limit 1–30)
- Uses `yt-dlp` (no shell; the query is passed as an argument). Live streams cannot be downloaded.
- Download only content you own or have permission to use.

## 🐧 Linux Install (Ubuntu / Arch)

**Ubuntu / Debian or Arch (script):**
```bash
sudo -S -p '' ./packaging/install.sh          # installs bun, yt-dlp, ffmpeg, then the systemd service
sudo -S -p '' ./packaging/uninstall.sh        # keeps media/config; add --purge to delete them
```

**Arch (native package):**
```bash
cd packaging/arch && makepkg -si
sudo -S -p '' systemctl enable --now fallinglight-media-controller
```

Installed layout: app in `/opt/fallinglight-media-controller`, media and settings in `/var/lib/fallinglight-media-controller`, config in `/etc/fallinglight-media-controller.env` (set `APP_PASS` and `SESSION_SECRET` there). Default port: 6140.

For a manual run, `FLMC_UPLOADS_DIR` and `FLMC_DATA_DIR` override the storage folders.
