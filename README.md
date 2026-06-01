# FallingLight School PR Media Controller

A standalone, high-performance desktop media controller application built with Python 3 and PySide6. Specially designed for public relations, school announcement rooms, and time-based automation, this software runs efficiently even on older Windows 10 hardware.

---

## Key Features

1. **Modular Architecture**: Separate packages for GUI (PySide6), Media Engine (VLC), and Automation Scheduler (APScheduler).
2. **Playlist Queue Management**: Add, delete, and reorder files or YouTube URL streams on the fly, with configurable loop counts per track.
3. **Strict Time Automation**: Build schedules to auto-trigger specific tracks/playlists at strict timestamps or weekly recurring schedules (e.g. morning routine music).
4. **Mic / PR Ducking**: Smoothly decrease playing volume to a low background level (configurable in settings) instantly for live public address announcements, then smoothly fade back up.
5. **Smooth Audio Transitions**: Linear volume fades when skipping or stopping tracks to avoid jarring audio cuts.
6. **Low-CPU Visual VU Meters**: Hardware-like Left/Right LED VU channels with peak holds, running on physical decay equations to prevent CPU spikes.
7. **Stand-alone Executable Support**: Designed to be compiled into a single EXE using PyInstaller.

---

## Technical Stack & Packages

- **Language**: Python 3.10+
- **GUI Framework**: [PySide6](https://pypi.org/project/PySide6/) (Qt6 Python bindings)
- **Media Engine**: [python-vlc](https://pypi.org/project/python-vlc/) (requires VLC player libraries installed on the system)
- **YouTube Integration**: [yt-dlp](https://github.com/yt-dlp/yt-dlp) (extracts streams on background worker threads)
- **Scheduling Engine**: [APScheduler](https://apscheduler.readthedocs.io/en/stable/) (running weekly cron triggers)
- **Packager**: [PyInstaller](https://pyinstaller.org/)

---

## Installation

### Prerequisite: VLC Media Player
Since the application uses VLC's native decoding codecs, you must have the **64-bit VLC media player** installed on your system:
- **Windows**: Download and install VLC from [videolan.org](https://www.videolan.org/). Ensure the installation architecture matches your Python interpreter (usually 64-bit).
- **Linux/macOS**: Install VLC via your system package manager (e.g., `sudo apt install vlc`).
*Note: If VLC is not found, the app automatically boots into simulated mode so that GUI layout and scheduling logic can still be fully tested and run.*

### Steps
1. Clone or download this project directory.
2. Open your terminal/command prompt and navigate to the project directory:
   ```bash
   cd "FallingLight Media controller"
   ```
3. Install dependencies from `requirements.txt`:
   ```bash
   pip install -r requirements.txt
   ```
4. Start the application:
   ```bash
   python main.py
   ```

---

## User Guide

### 1. Main Player Controls
- Use the playbar buttons to Pause, Resume, Stop, and Skip. Stop and Skip apply a **smooth volume fade-out** over 1-2 seconds.
- Drag the progress bar at the top and release it to **seek/scrub** through files.
- Activate the red **Mic / PR Mode** button to duck active playback immediately. Deactivating it restores volume levels smoothly.

### 2. Playlist Queue
- Click **Add Audio/Video Files** to load local media (MP3, WAV, MP4, etc.).
- Click **Add YouTube / URL** to input a YouTube link. The URL is resolved in a background thread without freezing the GUI.
- Double-click any item in the table to start playing it immediately.
- Use **Loops** spin box to repeat a track (set to `∞` to repeat forever).
- Click **▲ Up** and **▼ Down** to reorder items.

### 3. Automation Scheduler
- Complete the form on the right to schedule tasks.
- **Weekly Recurring**: Check this to select specific days (e.g., Monday through Friday) at a specific time.
- **One-time Date**: Uncheck "Weekly Recurring" to specify a calendar date.
- Enabled schedules run in the background. Schedulers persist inside `schedules.json` in the root folder.

---

## Building a Standalone Executable

To package the project into a single executable file (`.exe` on Windows) for standalone installation:

1. Install PyInstaller (included in `requirements.txt`):
   ```bash
   pip install pyinstaller
   ```
2. Run the packaging command from the root folder:
   ```bash
   pyinstaller --noconsole --onefile --name="FallingLightMediaWorkstation" main.py
   ```
   - `--noconsole` hides the cmd window.
   - `--onefile` outputs a single `.exe` file.
   - The compiled executable will be located inside the `dist/` directory.
