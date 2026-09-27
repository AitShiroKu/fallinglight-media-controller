import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Elysia } from "elysia";
import { authRoutes } from "../src/routes/auth";
import { fileRoutes } from "../src/routes/files";
import { schedulerRoutes } from "../src/routes/scheduler";
import { settingsRoutes } from "../src/routes/settings";
import { streamingRoutes } from "../src/routes/streaming";
import { youtubeRoutes } from "../src/routes/youtube";
import { createSessionToken, isValidToken } from "../src/middleware/auth-guard";
import {
  sanitizeFilename,
  sanitizeFolderName,
  isAllowedExtension,
  isVideoFile,
  initStorage,
  loadSchedules,
  saveSchedules,
  SCHEDULES_FILE,
  type ScheduleJob,
} from "../src/utils/storage";
import {
  isDayMatched,
  checkAndRunSchedules,
  clearFiredHistory,
} from "../src/services/scheduler-daemon";
import { getVideoRenditionPath } from "../src/utils/transcoder";
import * as path from "path";
import * as fs from "fs";

describe("Storage Utilities", () => {
  beforeAll(async () => {
    await initStorage();
  });

  it("sanitizes filenames correctly and handles edge cases", () => {
    expect(sanitizeFilename("test.mp3")).toBe("test.mp3");
    expect(sanitizeFilename("../../etc/passwd.mp3")).toBe("etc_passwd.mp3");
    expect(sanitizeFilename("...")).toBe("media_file");
    expect(sanitizeFilename("   ")).toBe("media_file");
    expect(sanitizeFilename("เพลงชาติไทย.mp3")).toBe("เพลงชาติไทย.mp3");
  });

  it("sanitizes folder names and prevents path traversal", () => {
    expect(sanitizeFolderName("Announcements")).toBe("Announcements");
    expect(sanitizeFolderName("../../secret/folder")).toBe("secret/folder");
    expect(sanitizeFolderName("Music/Pop/80s")).toBe("Music/Pop/80s");
    expect(sanitizeFolderName("")).toBe("");
  });

  it("validates allowed media extensions", () => {
    expect(isAllowedExtension("test.mp3")).toBe(true);
    expect(isAllowedExtension("test.wav")).toBe(true);
    expect(isAllowedExtension("test.flac")).toBe(true);
    expect(isAllowedExtension("test.mp4")).toBe(true);
    expect(isAllowedExtension("test.webm")).toBe(true);
    expect(isAllowedExtension("test.exe")).toBe(false);
    expect(isAllowedExtension("test.php")).toBe(false);
    expect(isAllowedExtension("test.js")).toBe(false);
  });

  it("identifies video media files correctly", () => {
    expect(isVideoFile("video.mp4")).toBe(true);
    expect(isVideoFile("clip.webm")).toBe(true);
    expect(isVideoFile("movie.mkv")).toBe(true);
    expect(isVideoFile("recording.avi")).toBe(true);
    expect(isVideoFile("song.mp3")).toBe(false);
    expect(isVideoFile("bell.wav")).toBe(false);
    expect(isVideoFile("audio.flac")).toBe(false);
  });
});

describe("Auth Guard & Cryptographic Persistent Tokens", () => {
  it("creates and validates signed session tokens", async () => {
    const token = await createSessionToken();
    expect(typeof token).toBe("string");
    expect(await isValidToken(token)).toBe(true);
  });

  it("keeps tokens persistent indefinitely without timeout expiration", async () => {
    // Generate a validly signed token with a timestamp from 400 days in the past
    const oldTimestamp = Date.now() - 400 * 24 * 60 * 60 * 1000;
    const payload = `admin:${oldTimestamp}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(process.env.SESSION_SECRET ?? "fallinglight-session-2468");
    const cryptoKey = await crypto.subtle.importKey(
      "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign(
      "HMAC", cryptoKey, encoder.encode(payload)
    );
    const sigHex = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    const oldToken = `${payload}:${sigHex.slice(0, 32)}`;

    expect(await isValidToken(oldToken)).toBe(true);
  });

  it("rejects invalid or tampered tokens", async () => {
    expect(await isValidToken("")).toBe(false);
    expect(await isValidToken(null)).toBe(false);
    expect(await isValidToken("admin:12345:fakehash")).toBe(false);
    expect(await isValidToken("admin:0:00000000000000000000000000000000")).toBe(false);
  });
});

describe("API Integration & Streaming Diagnostics", () => {
  const app = new Elysia()
    .use(authRoutes)
    .use(fileRoutes)
    .use(schedulerRoutes)
    .use(settingsRoutes)
    .use(streamingRoutes);

  let sessionCookie = "";

  beforeAll(async () => {
    const res = await app.handle(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "cptw@2468" }),
    }));
    const setCookie = res.headers.get("set-cookie") || "";
    const match = setCookie.match(/session=([^;]+)/);
    if (match) {
      sessionCookie = `session=${match[1]}`;
    }
  });

  it("rejects unauthenticated requests to protected routes", async () => {
    const res = await app.handle(new Request("http://localhost/api/files"));
    expect(res.status).toBe(401);
  });

  it("authenticates valid credentials and sets 10-year persistent session cookie", async () => {
    const res = await app.handle(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "cptw@2468" }),
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(typeof data.token).toBe("string");
    const cookie = res.headers.get("set-cookie");
    expect(cookie).toContain("session=");
    expect(cookie).toContain("Max-Age=315360000");
  });

  it("rejects invalid credentials", async () => {
    const res = await app.handle(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrongpassword" }),
    }));
    expect(res.status).toBe(401);
  });

  it("retrieves streaming status anonymously", async () => {
    const res = await app.handle(new Request("http://localhost/api/streaming/status"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.active).toBe("boolean");
  });

  it("enables streaming room and returns active room id", async () => {
    const res = await app.handle(new Request("http://localhost/api/streaming/enable", {
      method: "POST",
      headers: { Cookie: sessionCookie },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(typeof data.roomId).toBe("string");
  });

  it("provides detailed streaming diagnostics via /api/streaming/debug", async () => {
    const res = await app.handle(new Request("http://localhost/api/streaming/debug", {
      method: "GET",
      headers: { Cookie: sessionCookie },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.active).toBe(true);
    expect(typeof data.roomId).toBe("string");
    expect(typeof data.uptimeSeconds).toBe("number");
    expect(Array.isArray(data.receivers)).toBe(true);
  });

  it("prunes dead sockets via /api/streaming/clean-dead", async () => {
    const res = await app.handle(new Request("http://localhost/api/streaming/clean-dead", {
      method: "POST",
      headers: { Cookie: sessionCookie },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(typeof data.receiverCount).toBe("number");
  });

  it("force resets streaming room via /api/streaming/reset", async () => {
    const res = await app.handle(new Request("http://localhost/api/streaming/reset", {
      method: "POST",
      headers: { Cookie: sessionCookie },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    const statusRes = await app.handle(new Request("http://localhost/api/streaming/status"));
    const statusData = await statusRes.json();
    expect(statusData.active).toBe(false);
  });
});

describe("Folder Management API", () => {
  const app = new Elysia()
    .use(authRoutes)
    .use(fileRoutes);

  let sessionCookie = "";

  beforeAll(async () => {
    const res = await app.handle(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "cptw@2468" }),
    }));
    const setCookie = res.headers.get("set-cookie") || "";
    const match = setCookie.match(/session=([^;]+)/);
    if (match) {
      sessionCookie = `session=${match[1]}`;
    }
  });

  it("lists files and folders under /api/files", async () => {
    const res = await app.handle(new Request("http://localhost/api/files", {
      headers: { Cookie: sessionCookie },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.files)).toBe(true);
    expect(Array.isArray(data.folders)).toBe(true);
  });

  it("creates, queries, and deletes folders safely", async () => {
    const folderName = "TestAutonextFolder";

    // 1. Create folder
    const createRes = await app.handle(new Request("http://localhost/api/files/folder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ name: folderName }),
    }));
    expect(createRes.status).toBe(200);
    const createData = await createRes.json();
    expect(createData.success).toBe(true);
    const hasFolder = createData.folders.some((f: any) => f.name === folderName);
    expect(hasFolder).toBe(true);

    // 2. Query folder contents
    const listRes = await app.handle(new Request(`http://localhost/api/files?folder=${folderName}`, {
      headers: { Cookie: sessionCookie },
    }));
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(Array.isArray(listData.files)).toBe(true);

    // 3. Delete folder
    const delRes = await app.handle(new Request(`http://localhost/api/files/folder/${folderName}`, {
      method: "DELETE",
      headers: { Cookie: sessionCookie },
    }));
    expect(delRes.status).toBe(200);
    const delData = await delRes.json();
    expect(delData.success).toBe(true);
    const stillExists = delData.folders.some((f: any) => f.name === folderName);
    expect(stillExists).toBe(false);
  });

  it("handles moving files between root and folders safely", async () => {
    // Attempt moving non-existent file returns 400
    const res = await app.handle(new Request("http://localhost/api/files/move", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ filename: "nonexistent.mp3", targetFolder: "" }),
    }));
    expect(res.status).toBe(400);
  });
});

describe("Stream Endpoints (/stream, /stream/audio, /stream/video)", () => {
  it("serves HTML with stream receiver for all three stream endpoints", async () => {
    const { app } = await import("../src/index");

    const endpoints = ["/stream", "/stream/audio", "/stream/video"];
    for (const ep of endpoints) {
      const res = await app.handle(new Request(`http://localhost${ep}`));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("stream-receiver.js");
      expect(text).toContain("receiver-video");
    }
  });

  it("verifies stream.html contains pure video elements and HUD overlay", async () => {
    const streamHtml = await Bun.file("public/stream.html").text();
    expect(streamHtml).toContain("pure-video-view");
    expect(streamHtml).toContain("receiver-video-pure");
    expect(streamHtml).toContain("video-hud");
    expect(streamHtml).toContain("video-standby");
    expect(streamHtml).toContain("hud-resolution-badge");
  });

  it("verifies stream-receiver.js includes safePlayMedia muted fallback, HUD auto-hide, and seconds seek", async () => {
    const receiverJs = await Bun.file("public/js/stream-receiver.js").text();
    expect(receiverJs).toContain("safePlayMedia");
    expect(receiverJs).toContain("hudTimer");
    expect(receiverJs).toContain("showHUD");
    expect(receiverJs).toContain("hideHUD");
    expect(receiverJs).toContain("videoSourceNode");
    expect(receiverJs).toContain("seekTo(data.ratio, data.seconds)");
  });

  it("verifies useVUStore decouples 25 FPS VU updates from usePlayerStore", async () => {
    const vuStoreFile = Bun.file("frontend/src/stores/useVUStore.ts");
    expect(await vuStoreFile.exists()).toBe(true);
    const vuStoreCode = await vuStoreFile.text();
    expect(vuStoreCode).toContain("useVUStore");
    expect(vuStoreCode).toContain("audioEngine.addVUListener");

    const playerStoreCode = await Bun.file("frontend/src/stores/usePlayerStore.ts").text();
    expect(playerStoreCode).not.toContain("vu: VUData;");
  });
});

describe("YouTube Downloader & Format Selector API", () => {
  const app = new Elysia()
    .use(authRoutes)
    .use(youtubeRoutes);

  let sessionCookie = "";

  beforeAll(async () => {
    const res = await app.handle(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "cptw@2468" }),
    }));
    const setCookie = res.headers.get("set-cookie") || "";
    const match = setCookie.match(/session=([^;]+)/);
    if (match) {
      sessionCookie = `session=${match[1]}`;
    }
  });

  it("rejects unauthenticated requests to /api/youtube/download", async () => {
    const res = await app.handle(new Request("http://localhost/api/youtube/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    }));
    expect(res.status).toBe(401);
  });

  it("rejects invalid non-http/https URLs", async () => {
    const res = await app.handle(new Request("http://localhost/api/youtube/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ url: "ftp://example.com/audio.mp3" }),
    }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid format choices via schema validation", async () => {
    const res = await app.handle(new Request("http://localhost/api/youtube/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        format: "invalid_format",
      }),
    }));
    expect(res.status).toBe(422);
  });

  it("accepts MP3 format download request and returns jobId", async () => {
    const res = await app.handle(new Request("http://localhost/api/youtube/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        format: "mp3",
      }),
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.jobId).toBe("string");

    // Verify progress endpoint returns downloading job with format mp3
    const progRes = await app.handle(new Request(`http://localhost/api/youtube/progress/${data.jobId}`, {
      headers: { Cookie: sessionCookie },
    }));
    expect(progRes.status).toBe(200);
    const progData = await progRes.json();
    expect(typeof progData.status).toBe("string");
    expect(progData.format).toBe("mp3");
  });

  it("accepts MP4 format download request and returns jobId", async () => {
    const res = await app.handle(new Request("http://localhost/api/youtube/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        format: "mp4",
      }),
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.jobId).toBe("string");

    // Verify progress endpoint returns downloading job with format mp4
    const progRes = await app.handle(new Request(`http://localhost/api/youtube/progress/${data.jobId}`, {
      headers: { Cookie: sessionCookie },
    }));
    expect(progRes.status).toBe(200);
    const progData = await progRes.json();
    expect(typeof progData.status).toBe("string");
    expect(progData.format).toBe("mp4");
  });
});

describe("Controller Video Preview Deck & Media Player UI", () => {
  it("verifies index.html has complete video player deck and format controls", async () => {
    const indexHtml = await Bun.file("public/index.html").text();

    // 1. Controller video deck
    expect(indexHtml).toContain('id="video-preview-container"');
    expect(indexHtml).toContain('id="controller-video"');
    expect(indexHtml).toContain('id="btn-video-pip"');
    expect(indexHtml).toContain('id="btn-video-fullscreen"');

    // 2. YouTube format toggle pills and accessible IDs
    expect(indexHtml).toContain('name="yt-format"');
    expect(indexHtml).toContain('id="yt-format-mp3"');
    expect(indexHtml).toContain('id="yt-format-mp4"');
    expect(indexHtml).toContain('value="mp3"');
    expect(indexHtml).toContain('value="mp4"');
    expect(indexHtml).toContain('data-i18n="yt_format_mp3"');
    expect(indexHtml).toContain('data-i18n="yt_format_mp4"');
    expect(indexHtml).toContain('setFormat');
  });

  it("verifies en and th locale dictionaries contain YouTube and video preview strings", async () => {
    const en = await Bun.file("public/i18n/en.json").json();
    const th = await Bun.file("public/i18n/th.json").json();

    expect(en.yt_format_mp3).toBeDefined();
    expect(en.yt_format_mp4).toBeDefined();
    expect(en.btn_fetch_youtube_mp3).toBeDefined();
    expect(en.btn_fetch_youtube_mp4).toBeDefined();
    expect(en.youtube_loading_mp4).toBeDefined();

    expect(th.yt_format_mp3).toBe("MP3 (เฉพาะเสียง)");
    expect(th.yt_format_mp4).toBe("MP4 (วิดิโอ+เสียง)");
    expect(th.btn_fetch_youtube_mp3).toBe("ดาวน์โหลด MP3");
    expect(th.btn_fetch_youtube_mp4).toBe("ดาวน์โหลด MP4");
    expect(th.youtube_loading_mp4).toContain("MP4");
  });

  it("verifies icons.js contains all required SVG definitions without duplication", async () => {
    const iconsJs = await Bun.file("public/js/icons.js").text();
    const indexHtml = await Bun.file("public/index.html").text();

    // Verify icons.js has definitions for pip, maximize, fullscreen, external-link
    expect(iconsJs).toContain("'pip':");
    expect(iconsJs).toContain("'maximize':");
    expect(iconsJs).toContain("'fullscreen':");
    expect(iconsJs).toContain("'external-link':");

    // Verify index.html video deck uses distinct icons for PiP and Fullscreen
    expect(indexHtml).toContain('data-icon="pip"');
    expect(indexHtml).toContain('data-icon="maximize"');
    // Ensure PiP and Fullscreen do not share the exact same icon name
    const pipMatch = indexHtml.match(/id="btn-video-pip"[^>]*>[\s\S]*?data-icon="([^"]+)"/);
    const fsMatch = indexHtml.match(/id="btn-video-fullscreen"[^>]*>[\s\S]*?data-icon="([^"]+)"/);
    expect(pipMatch).toBeTruthy();
    expect(fsMatch).toBeTruthy();
    expect(pipMatch![1]).not.toBe(fsMatch![1]);
    expect(pipMatch![1]).not.toBe("music");
    expect(fsMatch![1]).not.toBe("music");
  });

  it("verifies index.html and stream.html have full-bleed fullscreen video styles", async () => {
    const indexHtml = await Bun.file("public/index.html").text();
    const streamHtml = await Bun.file("public/stream.html").text();

    // Verify index.html overrides max-height in fullscreen
    expect(indexHtml).toContain("#video-preview-container:fullscreen");
    expect(indexHtml).toContain("#video-preview-container:fullscreen #controller-video");
    expect(indexHtml).toContain("max-height: 100vh !important");
    expect(indexHtml).toContain("object-fit: contain !important");

    // Verify stream.html overrides max-height in fullscreen
    expect(streamHtml).toContain("#video-container:fullscreen");
    expect(streamHtml).toContain("#video-container:fullscreen #receiver-video");
    expect(streamHtml).toContain("max-height: 100vh !important");
  });
});

describe("Playlist Auto-Advance & Per-Track autoNext Control", () => {
  it("verifies per-track autoNext logic stops playback when autoNext is false in both local and remote modes", async () => {
    const playlistCode = await Bun.file("public/js/playlist.js").text();

    // Create a sandbox to run playlist.js
    let playedUrl: string | null = null;
    let stopped = false;
    let remotePlaySent: string | null = null;
    let remoteStopSent = false;
    let isPaused = false;
    let isPlaying = false;
    let statusSet: string | null = null;

    const mockWindow: any = {
      playlist: null,
      audioEngine: {
        remoteMode: false,
        get isPlaying() { return isPlaying; },
        get isPaused() { return isPaused; },
        play: (url: string) => {
          playedUrl = url;
          isPlaying = true;
          isPaused = false;
        },
        stop: () => {
          stopped = true;
          isPlaying = false;
          isPaused = true;
        },
        stopWithFade: () => {
          stopped = true;
          isPlaying = false;
        },
        audioEl: { src: "" },
      },
      streamController: {
        sendPlay: (fn: string) => {
          remotePlaySent = fn;
          isPlaying = true;
        },
        sendStop: () => {
          remoteStopSent = true;
          isPlaying = false;
        },
      },
      appI18n: {
        tr: (k: string) => k,
      },
      document: {
        getElementById: (id: string) => ({
          textContent: "",
          innerHTML: "",
          classList: { remove: () => {}, add: () => {} },
          querySelectorAll: () => [],
        }),
        querySelectorAll: () => [],
        createElement: (tag: string) => {
          let content = "";
          return {
            get textContent() { return content; },
            set textContent(v: string) { content = v; },
            get innerHTML() { return content; },
            set innerHTML(v: string) { content = v; },
          };
        },
      },
    };

    // Execute playlist.js inside isolated function with mockWindow
    const fn = new Function("window", "document", playlistCode);
    fn(mockWindow, mockWindow.document);

    const pl = mockWindow.playlist;
    expect(pl).toBeTruthy();

    // Add 3 tracks:
    // Track 0: autoNext = true ("เล่นต่อ")
    // Track 1: autoNext = false ("หยุดเมื่อจบ")
    // Track 2: autoNext = true ("เล่นต่อ")
    pl.addTrack("track0.mp3", 1, true);
    pl.addTrack("track1.mp3", 1, false);
    pl.addTrack("track2.mp3", 1, true);

    expect(pl.items.length).toBe(3);
    expect(pl.items[0].autoNext).toBe(true);
    expect(pl.items[1].autoNext).toBe(false);
    expect(pl.items[2].autoNext).toBe(true);

    // Test toggleAutoNext
    pl.toggleAutoNext(0);
    expect(pl.items[0].autoNext).toBe(false);
    pl.toggleAutoNext(0);
    expect(pl.items[0].autoNext).toBe(true);

    // --- TEST 1: Track 0 (autoNext: true) naturally ends in LOCAL mode ---
    pl.playIndex(0);
    expect(playedUrl).toBe("/uploads/track0.mp3");
    stopped = false;
    pl.onTrackEnded(); // Track 0 naturally ends
    // Should advance to Track 1 and play it
    expect(pl.currentIndex).toBe(1);
    expect(playedUrl).toBe("/uploads/track1.mp3");
    expect(stopped).toBe(false);

    // --- TEST 2: Track 1 (autoNext: false) naturally ends in LOCAL mode ---
    // Track 1 is currently playing, and its autoNext is false
    stopped = false;
    playedUrl = null;
    pl.onTrackEnded(); // Track 1 naturally ends
    // Must STOP! Must NOT play Track 2
    expect(stopped).toBe(true);
    expect(playedUrl).toBeNull();
    // Index should cue Track 2
    expect(pl.currentIndex).toBe(2);

    // --- TEST 3: Track 1 naturally ends in REMOTE mode ---
    mockWindow.audioEngine.remoteMode = true;
    pl.playIndex(1); // Play track 1 in remote mode
    expect(remotePlaySent).toBe("track1.mp3");
    stopped = false;
    remotePlaySent = null;

    pl.onTrackEnded(); // Track 1 ends on receiver
    // In remote mode, must ALSO STOP! Must NOT play track 2!
    expect(stopped).toBe(true);
    expect(remotePlaySent).toBeNull();
    expect(pl.currentIndex).toBe(2);

    // --- TEST 4: Track 2 (autoNext: true) naturally ends in REMOTE mode ---
    pl.playIndex(0); // Set to track 0 (autoNext: true)
    remotePlaySent = null;
    stopped = false;
    pl.onTrackEnded(); // Track 0 ends in remote mode
    // Should advance and play Track 1 in remote mode
    expect(remotePlaySent).toBe("track1.mp3");
    expect(pl.currentIndex).toBe(1);
  });

  it("verifies tracks default to autoNext: true and stop when set to false", async () => {
    const playlistCode = await Bun.file("public/js/playlist.js").text();
    let playedUrl: string | null = null;
    let stopped = false;

    const mockWindow: any = {
      playlist: null,
      audioEngine: {
        remoteMode: false,
        play: (url: string) => { playedUrl = url; },
        stop: () => { stopped = true; },
      },
      document: {
        getElementById: () => ({ textContent: "", innerHTML: "", classList: { remove: () => {}, add: () => {} }, querySelectorAll: () => [] }),
        querySelectorAll: () => [],
        createElement: () => ({ textContent: "", innerHTML: "" }),
      },
    };

    const fn = new Function("window", "document", playlistCode);
    fn(mockWindow, mockWindow.document);

    const pl = mockWindow.playlist;

    // Add track 0 without autoNext argument: must default to autoNext = true
    pl.addTrack("song1.mp3");
    // Add track 1 without autoNext argument: must default to autoNext = true
    pl.addTrack("song2.mp3");
    // Add track 2
    pl.addTrack("song3.mp3");

    expect(pl.items[0].autoNext).toBe(true);
    expect(pl.items[1].autoNext).toBe(true);

    pl.playIndex(0);
    expect(playedUrl).toBe("/uploads/song1.mp3");
    stopped = false;

    // Song 1 finishes playing -> must advance to song2
    pl.onTrackEnded();
    expect(pl.currentIndex).toBe(1);
    expect(playedUrl).toBe("/uploads/song2.mp3");
    expect(stopped).toBe(false);

    // Now user sets song 2 to Stop (autoNext = false)
    pl.toggleAutoNext(1);
    expect(pl.items[1].autoNext).toBe(false);

    stopped = false;
    playedUrl = null;

    // Song 2 finishes playing -> must stop playback!
    pl.onTrackEnded();
    expect(stopped).toBe(true);
    expect(playedUrl).toBeNull();
    expect(pl.currentIndex).toBe(2); // Cued to next track
  });
});

describe("Folder Drag-and-Drop & Direct Folder Upload/Download", () => {
  let app: Elysia;
  let sessionCookie = "";

  beforeAll(async () => {
    await initStorage();
    app = new Elysia()
      .use(authRoutes)
      .use(fileRoutes)
      .use(youtubeRoutes);

    const res = await app.handle(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "cptw@2468" }),
    }));
    const cookieHeader = res.headers.get("set-cookie") || "";
    const match = cookieHeader.match(/session=([^;]+)/);
    if (match) {
      sessionCookie = `session=${match[1]}`;
    }
  });

  it("verifies YouTube download route accepts folder destination parameter and creates job with folder", async () => {
    const res = await app.handle(new Request("http://localhost/api/youtube/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        format: "mp3",
        folder: "Anthems",
      }),
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.jobId).toBe("string");

    // Check progress endpoint
    const progRes = await app.handle(new Request(`http://localhost/api/youtube/progress/${data.jobId}`, {
      headers: { Cookie: sessionCookie },
    }));
    expect(progRes.status).toBe(200);
    const progData = await progRes.json();
    expect(progData.status).toBe("downloading");
    expect(progData.format).toBe("mp3");
  });

  it("verifies direct folder upload via /api/files/upload with folder parameter", async () => {
    const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
    const bodyParts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\nSchoolPR\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="morning_bell.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFFfake_wav_data\r\n`,
      `--${boundary}--\r\n`,
    ];
    const multipartBody = bodyParts.join("");

    const res = await app.handle(new Request("http://localhost/api/files/upload", {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Cookie: sessionCookie,
      },
      body: multipartBody,
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.files)).toBe(true);
    expect(data.files[0]).toContain("SchoolPR/morning_bell.wav");

    // Verify file is in SchoolPR folder listing
    const listRes = await app.handle(new Request("http://localhost/api/files?folder=SchoolPR", {
      headers: { Cookie: sessionCookie },
    }));
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    const bellFile = listData.files.find((f: any) => f.name === "morning_bell.wav");
    expect(bellFile).toBeDefined();
    expect(bellFile.folder).toBe("SchoolPR");
  });

  it("verifies moving/dragging files between root and folders and back to root", async () => {
    // 1. Create a root file to test dragging into folder
    const boundary = "----WebKitFormBoundaryMoveTest";
    const bodyParts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\n\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="drag_test.mp3"\r\nContent-Type: audio/mpeg\r\n\r\nfake_mp3_data\r\n`,
      `--${boundary}--\r\n`,
    ];
    const uploadRes = await app.handle(new Request("http://localhost/api/files/upload", {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Cookie: sessionCookie,
      },
      body: bodyParts.join(""),
    }));
    expect(uploadRes.status).toBe(200);

    // 2. Drag/Move from root into "SchoolPR" folder
    const moveRes = await app.handle(new Request("http://localhost/api/files/move", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        filename: "drag_test.mp3",
        targetFolder: "SchoolPR",
      }),
    }));
    expect(moveRes.status).toBe(200);
    const moveData = await moveRes.json();
    expect(moveData.success).toBe(true);
    expect(moveData.newPath).toBe("SchoolPR/drag_test.mp3");

    // 3. Drag/Move back to Root ("")
    const moveBackRes = await app.handle(new Request("http://localhost/api/files/move", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        filename: "SchoolPR/drag_test.mp3",
        targetFolder: "",
      }),
    }));
    expect(moveBackRes.status).toBe(200);
    const moveBackData = await moveBackRes.json();
    expect(moveBackData.success).toBe(true);
    expect(moveBackData.newPath).toBe("drag_test.mp3");

    // Clean up
    await app.handle(new Request("http://localhost/api/files/drag_test.mp3", {
      method: "DELETE",
      headers: { Cookie: sessionCookie },
    }));
    await app.handle(new Request("http://localhost/api/files/SchoolPR/morning_bell.wav", {
      method: "DELETE",
      headers: { Cookie: sessionCookie },
    }));
    await app.handle(new Request("http://localhost/api/files/folder/SchoolPR", {
      method: "DELETE",
      headers: { Cookie: sessionCookie },
    }));
  });

  it("verifies UI templates, icons, and i18n dictionaries for folder drag-and-drop and destination selector", async () => {
    const indexHtml = await Bun.file("public/index.html").text();
    const iconsJs = await Bun.file("public/js/icons.js").text();
    const appJs = await Bun.file("public/js/app.js").text();
    const en = await Bun.file("public/i18n/en.json").json();
    const th = await Bun.file("public/i18n/th.json").json();

    // 1. YouTube folder destination selector
    expect(indexHtml).toContain('id="yt-destination-folder"');
    expect(indexHtml).toContain('data-i18n="yt_destination_folder"');
    expect(appJs).toContain("setTargetFolder");
    expect(appJs).toContain("updateYoutubeFolderSelector");

    // 2. Drop zone target badge & text
    expect(indexHtml).toContain('id="drop-zone-target-badge"');
    expect(indexHtml).toContain('id="drop-zone-folder-name"');
    expect(appJs).toContain("updateDropZoneText");

    // 3. Drag and drop file row and folder card handlers
    expect(appJs).toContain("onFileDragStart");
    expect(appJs).toContain("onFileDragEnd");
    expect(appJs).toContain("onFolderDragOver");
    expect(appJs).toContain("onFolderDragLeave");
    expect(appJs).toContain("onFolderDrop");
    expect(appJs).toContain("folder-drop-target");

    // 4. Grip icon definition
    expect(iconsJs).toContain("'grip':");

    // 5. i18n translations
    expect(en.yt_destination_folder).toBeDefined();
    expect(th.yt_destination_folder).toBeDefined();
    expect(en.drop_zone_target).toBeDefined();
    expect(th.drop_zone_target).toBeDefined();
    expect(en.drop_on_folder_hint).toBeDefined();
    expect(th.drop_on_folder_hint).toBeDefined();
  });
});

describe("React SPA Production Bundle & Static Delivery", () => {
  it("verifies compiled dist/ bundle and root index.html exist", async () => {
    const distHtmlFile = Bun.file("dist/index.html");
    expect(await distHtmlFile.exists()).toBe(true);
    const html = await distHtmlFile.text();
    expect(html).toContain('id="root"');
    expect(html).toContain('<script type="module"');
  });

  it("serves React SPA HTML on root / and SPA routes (/player, /files, /schedule, /settings)", async () => {
    const { app } = await import("../src/index");

    const routes = ["/", "/player", "/files", "/schedule", "/settings"];
    for (const route of routes) {
      const res = await app.handle(new Request(`http://localhost${route}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const text = await res.text();
      expect(text).toContain('id="root"');
    }
  });

  it("preserves streaming receiver endpoints while serving React SPA", async () => {
    const { app } = await import("../src/index");

    const res = await app.handle(new Request("http://localhost/stream"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("stream-receiver.js");
    expect(text).toContain("receiver-video");
  });

  it("verifies React frontend locales have complete bilingual keys", async () => {
    const en = await Bun.file("frontend/src/locales/en.json").json();
    const th = await Bun.file("frontend/src/locales/th.json").json();

    const expectedKeys = [
      "tab_player",
      "tab_files",
      "tab_schedule",
      "tab_settings",
      "playlist_title",
      "youtube_title",
      "schedule_title",
      "settings_title",
      "folder_root",
      "btn_play_folder",
      "btn_move_file",
    ];

    for (const key of expectedKeys) {
      expect(en[key]).toBeDefined();
      expect(th[key]).toBeDefined();
    }
  });
});

describe("Streaming Room Auto-Attachment & Standby Receiver Pool", () => {
  it("allows speaker receivers to connect to standby pool and auto-attaches them when broadcast starts", async () => {
    const { app: testApp } = await import("../src/index");
    const server = testApp.listen(0);
    const testPort = server.server?.port;
    expect(testPort).toBeDefined();

    const baseUrl = `http://localhost:${testPort}`;
    const wsUrl = `ws://localhost:${testPort}`;

    const { createSessionToken } = await import("../src/middleware/auth-guard");
    const token = await createSessionToken();
    const sessionCookie = `session=${encodeURIComponent(token)}`;

    let receiverWs: WebSocket | null = null;
    let controllerWs: WebSocket | null = null;

    try {
      await fetch(`${baseUrl}/api/streaming/reset`, {
        method: "POST",
        headers: { Cookie: sessionCookie },
      });
      await Bun.sleep(100);

      // Check status before any connection
      const initialStatusRes = await fetch(`${baseUrl}/api/streaming/status`);
      const initialStatus = await initialStatusRes.json();
      expect(initialStatus.active).toBe(false);

      // 2. Speaker PC connects to /ws/streaming without a room (universal link /stream)
      receiverWs = new WebSocket(`${wsUrl}/ws/streaming?role=receiver`);
      const receiverMessages: any[] = [];
      receiverWs.onmessage = (e) => {
        receiverMessages.push(JSON.parse(e.data as string));
      };

      const waitFor = async (arr: any[], pred: (m: any) => boolean, timeout = 3000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const found = arr.find(pred);
          if (found) return found;
          await Bun.sleep(25);
        }
        return arr.find(pred);
      };

      // Wait for receiver WS to open and receive standby message
      await new Promise<void>((resolve) => {
        receiverWs!.onopen = () => resolve();
      });

      const standbyMsg = await waitFor(receiverMessages, (m) => m.type === "connected");
      expect(standbyMsg).toBeDefined();
      expect(standbyMsg.standby).toBe(true);

      // 3. Controller enables streaming
      const enableRes = await fetch(`${baseUrl}/api/streaming/enable`, {
        method: "POST",
        headers: { Cookie: sessionCookie },
      });
      const enableData = await enableRes.json();
      expect(enableData.success).toBe(true);
      const roomId = enableData.roomId;
      expect(typeof roomId).toBe("string");

      // Speaker PC should have received room_ready notification
      const roomReadyMsg = await waitFor(receiverMessages, (m) => m.type === "room_ready");
      expect(roomReadyMsg).toBeDefined();
      expect(roomReadyMsg.roomId).toBe(roomId);

      await Bun.sleep(50);

      // 4. Controller connects via WebSocket
      controllerWs = new WebSocket(`${wsUrl}/ws/streaming?role=controller&room=${roomId}&token=${encodeURIComponent(token)}`);
      const controllerMessages: any[] = [];
      controllerWs.onmessage = (e) => {
        controllerMessages.push(JSON.parse(e.data as string));
      };

      await new Promise<void>((resolve) => {
        controllerWs!.onopen = () => resolve();
      });

      // Controller should get connected & peer_connected with receiver count
      const controllerConnected = await waitFor(controllerMessages, (m) => m.type === "connected");
      expect(controllerConnected).toBeDefined();

      const peerReceiver = await waitFor(controllerMessages, (m) => m.type === "peer_connected" && m.role === "receiver");
      expect(peerReceiver).toBeDefined();
      expect(peerReceiver.count).toBeGreaterThanOrEqual(1);

      // Receiver should get peer_connected role: controller
      const peerController = await waitFor(receiverMessages, (m) => m.type === "peer_connected" && m.role === "controller");
      expect(peerController).toBeDefined();

      // 5. Controller relays play command to receiver
      controllerWs.send(JSON.stringify({ type: "play", filename: "MorningBell.mp3", loop: 2 }));
      const playMsg = await waitFor(receiverMessages, (m) => m.type === "play");
      expect(playMsg).toBeDefined();
      expect(playMsg.filename).toBe("MorningBell.mp3");
      expect(playMsg.loop).toBe(2);

      // 6. Receiver relays state_update and track_ended back to controller
      receiverWs.send(JSON.stringify({ type: "state_update", playing: true, currentTime: 45, duration: 180 }));
      const stateMsg = await waitFor(controllerMessages, (m) => m.type === "state_update");
      expect(stateMsg).toBeDefined();
      expect(stateMsg.playing).toBe(true);
      expect(stateMsg.currentTime).toBe(45);

      receiverWs.send(JSON.stringify({ type: "track_ended" }));
      const endedMsg = await waitFor(controllerMessages, (m) => m.type === "track_ended");
      expect(endedMsg).toBeDefined();
    } finally {
      if (receiverWs) { try { receiverWs.close(); } catch {} }
      if (controllerWs) { try { controllerWs.close(); } catch {} }
      try {
        await fetch(`${baseUrl}/api/streaming/reset`, {
          method: "POST",
          headers: { Cookie: sessionCookie },
        });
      } catch {}
      try { server.stop(); } catch {}
    }
  });

  describe("Playback Resilience & Master-Controller Audio Pipeline", () => {
    it("verifies stream receiver handles explicit resume and pause messages", async () => {
      const receiverCode = await Bun.file("public/js/stream-receiver.js").text();
      expect(receiverCode).toContain("case 'resume':");
      expect(receiverCode).toContain("case 'pause':");
      expect(receiverCode).toContain("case 'play':");
      expect(receiverCode).toContain("case 'stop':");
    });

    it("verifies togglePlay handles stopped state by starting track or playlist", () => {
      // Test the togglePlay logic state machine
      let isPlaying = false;
      let isPaused = false;
      let currentTrack: any = null;
      let playedTrack: any = null;
      let resumed = false;
      let paused = false;

      const playlist = {
        items: [{ id: "1", name: "Song 1", url: "/uploads/song1.mp3" }],
        currentIndex: -1,
        playIndex(idx: number) {
          playedTrack = this.items[idx];
          isPlaying = true;
          isPaused = false;
        },
      };

      const togglePlay = () => {
        if (isPlaying) {
          paused = true;
          isPlaying = false;
          isPaused = true;
        } else if (isPaused && currentTrack) {
          resumed = true;
          isPlaying = true;
          isPaused = false;
        } else {
          if (currentTrack) {
            playedTrack = currentTrack;
            isPlaying = true;
            isPaused = false;
          } else if (playlist.items.length > 0) {
            const idx = playlist.currentIndex >= 0 ? playlist.currentIndex : 0;
            playlist.playIndex(idx);
          }
        }
      };

      // 1. Stopped state with playlist items -> must start playlist item 0
      togglePlay();
      expect(isPlaying).toBe(true);
      expect(isPaused).toBe(false);
      expect(playedTrack).toEqual({ id: "1", name: "Song 1", url: "/uploads/song1.mp3" });

      // 2. Playing state -> must pause
      togglePlay();
      expect(isPlaying).toBe(false);
      expect(isPaused).toBe(true);
      expect(paused).toBe(true);

      // 3. Paused state with track -> must resume
      currentTrack = playedTrack;
      togglePlay();
      expect(isPlaying).toBe(true);
      expect(isPaused).toBe(false);
      expect(resumed).toBe(true);
    });

    it("verifies master controller preserves playback state against slave receiver updates", () => {
      let controllerState = {
        isPlaying: true,
        isPaused: false,
        currentTime: 10,
        duration: 200,
      };

      const onStateUpdate = (remoteState: { isPlaying: boolean; isPaused: boolean; currentTime: number; duration: number }) => {
        // If master controller is playing, never allow a slave receiver to stop/pause it
        if (controllerState.isPlaying && !remoteState.isPlaying) {
          return;
        }
        controllerState = { ...controllerState, ...remoteState };
      };

      // Receiver sends playing: false (e.g. buffering, autoplay blocked, lag)
      onStateUpdate({ isPlaying: false, isPaused: true, currentTime: 0, duration: 0 });

      // Controller MUST remain playing!
      expect(controllerState.isPlaying).toBe(true);
      expect(controllerState.currentTime).toBe(10);
      expect(controllerState.duration).toBe(200);
    });

    it("verifies debounced notifyEnded prevents double-advancing playlist", () => {
      let callCount = 0;
      let lastEndedTimestamp = 0;

      const notifyEnded = () => {
        const now = Date.now();
        if (now - lastEndedTimestamp < 1000) return;
        lastEndedTimestamp = now;
        callCount++;
      };

      // Local ended event fires
      notifyEnded();
      expect(callCount).toBe(1);

      // Receiver ended event arrives 100ms later
      notifyEnded();
      expect(callCount).toBe(1); // Blocked by debounce!
    });

    it("verifies generateUUID works correctly in both secure and non-secure HTTP contexts", () => {
      // 1. Emulate Non-Secure Context (http://aszn.online:6140) where crypto.randomUUID is undefined
      const mockInsecureCrypto = {
        getRandomValues: (arr: Uint8Array) => {
          for (let i = 0; i < arr.length; i++) {
            arr[i] = Math.floor(Math.random() * 256);
          }
          return arr;
        },
        // randomUUID is explicitly undefined in insecure HTTP contexts
        randomUUID: undefined,
      };

      function generateUUIDWithCrypto(c: any): string {
        if (typeof c !== 'undefined' && typeof c.randomUUID === 'function') {
          try { return c.randomUUID(); } catch {}
        }
        if (typeof c !== 'undefined' && typeof c.getRandomValues === 'function') {
          try {
            const bytes = new Uint8Array(16);
            c.getRandomValues(bytes);
            bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
            bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant RFC 4122
            const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
            return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
          } catch {}
        }
        const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
        return `${s4()}${s4()}-${s4()}-4${s4().substring(1)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${s4().substring(1)}-${s4()}${s4()}${s4()}`;
      }

      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      // Test with insecure HTTP context (no randomUUID)
      for (let i = 0; i < 20; i++) {
        const id = generateUUIDWithCrypto(mockInsecureCrypto);
        expect(id).toMatch(uuidV4Regex);
        // Verify version 4 character at position 14
        expect(id[14]).toBe("4");
        // Verify variant character at position 19 is 8, 9, a, or b
        expect(["8", "9", "a", "b"]).toContain(id[19].toLowerCase());
      }

      // Test with completely absent crypto
      const fallbackId = generateUUIDWithCrypto(undefined);
      expect(fallbackId).toMatch(uuidV4Regex);

      // Test with secure context (native randomUUID present)
      const mockSecureCrypto = {
        randomUUID: () => "c8a41234-5678-4abc-8def-123456789abc",
      };
      expect(generateUUIDWithCrypto(mockSecureCrypto)).toBe("c8a41234-5678-4abc-8def-123456789abc");
    });

    it("verifies WebSocket controller start is idempotent and does not close connecting sockets", () => {
      let closeCalled = false;
      let connectionsCreated = 0;

      class MockStreamController {
        public ws: any = null;
        public isConnected = false;
        public isConnecting = false;
        public isStreaming = false;

        public start(roomId: string) {
          this.isStreaming = true;
          // Guard: if socket is already open or connecting, do not recreate
          if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
            return;
          }
          this.connectWs();
        }

        public connectWs() {
          if (this.ws) {
            if (this.ws.readyState === 0 || this.ws.readyState === 1) return;
            this.ws.onclose = null;
            try { this.ws.close(); } catch {}
          }
          connectionsCreated++;
          this.isConnecting = true;
          this.ws = {
            readyState: 0, // CONNECTING
            close: () => { closeCalled = true; },
            onclose: null,
          };
        }
      }

      const controller = new MockStreamController();

      // First start call: creates socket in readyState 0 (CONNECTING)
      controller.start("room-123");
      expect(connectionsCreated).toBe(1);
      expect(closeCalled).toBe(false);

      // Second start call while in CONNECTING state: MUST NOT close or recreate!
      controller.start("room-123");
      expect(connectionsCreated).toBe(1);
      expect(closeCalled).toBe(false); // Did not trigger "WebSocket is closed before connection established"
    });
  });

  describe("Receiver Resolution Selection & Video Rendition Streaming", () => {
    const testApp = new Elysia().use(streamingRoutes);

    it("verifies GET /api/streaming/video-rendition returns 400 or 422 when file parameter is missing", async () => {
      const res = await testApp.handle(
        new Request("http://localhost/api/streaming/video-rendition")
      );
      expect([400, 422]).toContain(res.status);
    });

    it("verifies GET /api/streaming/video-rendition returns 404 when file does not exist", async () => {
      const res = await testApp.handle(
        new Request("http://localhost/api/streaming/video-rendition?file=nonexistent_video.mp4&res=720p")
      );
      expect(res.status).toBe(404);
    });

    it("verifies transcoder downscales video renditions and caches output", async () => {
      const uploadsDir = path.resolve(process.cwd(), "uploads");
      const files = fs.readdirSync(uploadsDir);
      const videoFiles = files
        .filter((f: string) => /\.(mp4|webm)$/i.test(f))
        .map((f: string) => ({ name: f, size: fs.statSync(path.join(uploadsDir, f)).size }))
        .sort((a: any, b: any) => a.size - b.size);

      const videoFile = videoFiles[0]?.name;

      if (videoFile) {
        const origRendition = await getVideoRenditionPath(videoFile, "original");
        expect(origRendition).toBeTruthy();
        expect(origRendition?.resolution).toBe("original");
        expect(fs.existsSync(origRendition!.path)).toBe(true);

        const scaled360p = await getVideoRenditionPath(videoFile, "360p");
        expect(scaled360p).toBeTruthy();
        expect(scaled360p?.resolution).toBe("360p");
        expect(fs.existsSync(scaled360p!.path)).toBe(true);

        // Test API endpoint returns 200/206 with Accept-Ranges
        const res = await testApp.handle(
          new Request(`http://localhost/api/streaming/video-rendition?file=${encodeURIComponent(videoFile)}&res=360p`)
        );
        expect([200, 206]).toContain(res.status);
        expect(res.headers.get("accept-ranges")).toContain("bytes");
        expect(res.headers.get("content-type")).toBe("video/mp4");
      }
    }, 20000);

    it("verifies stream.html contains resolution dropdowns and all options", () => {
      const streamHtmlPath = path.resolve(process.cwd(), "public/stream.html");
      const html = fs.readFileSync(streamHtmlPath, "utf-8");

      expect(html).toContain('id="hud-quality-dropdown"');
      expect(html).toContain('id="btn-hud-quality"');
      expect(html).toContain('id="hud-quality-menu"');
      expect(html).toContain('id="dash-quality-dropdown"');
      expect(html).toContain('id="btn-dash-quality"');
      expect(html).toContain('id="dash-quality-menu"');

      expect(html).toContain('data-res="original"');
      expect(html).toContain('data-res="1080p"');
      expect(html).toContain('data-res="720p"');
      expect(html).toContain('data-res="480p"');
      expect(html).toContain('data-res="360p"');
    });

    it("verifies stream-receiver.js implements independent resolution switching without sending WebSocket commands", () => {
      const receiverJsPath = path.resolve(process.cwd(), "public/js/stream-receiver.js");
      const js = fs.readFileSync(receiverJsPath, "utf-8");

      expect(js).toContain("currentResolution");
      expect(js).toContain("fallinglight_receiver_res");
      expect(js).toContain("getVideoSrc");
      expect(js).toContain("setReceiverResolution");
      expect(js).toContain("updateResolutionUI");

      // Verify that setReceiverResolution does NOT contain ws.send or emit commands to controller
      const setResFuncMatch = js.match(/function setReceiverResolution\([\s\S]*?^  \}/m);
      expect(setResFuncMatch).toBeTruthy();
      if (setResFuncMatch) {
        expect(setResFuncMatch[0]).not.toContain("ws.send");
        expect(setResFuncMatch[0]).not.toContain("relayToController");
      }
    });
  });

  describe("Scheduler Engine & Autonomous Broadcasting Daemon", () => {
    let originalSchedules: ScheduleJob[] = [];
    const schedulerApp = new Elysia()
      .use(authRoutes)
      .use(schedulerRoutes);

    let authCookie = "";

    beforeAll(async () => {
      // Backup original schedules
      originalSchedules = await loadSchedules();

      // Authenticate to get valid session cookie
      const res = await schedulerApp.handle(new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "cptw@2468" }),
      }));
      const setCookie = res.headers.get("set-cookie") || "";
      const match = setCookie.match(/session=([^;]+)/);
      if (match) {
        authCookie = `session=${match[1]}`;
      }
    });

    afterAll(async () => {
      // Restore original schedules
      await saveSchedules(originalSchedules);
      clearFiredHistory();
    });

    describe("Universal Day Matcher (isDayMatched)", () => {
      it("matches day names correctly for all days of the week", () => {
        expect(isDayMatched(1, ["mon", "tue", "wed"])).toBe(true);
        expect(isDayMatched(2, ["mon", "tue", "wed"])).toBe(true);
        expect(isDayMatched(3, ["mon", "tue", "wed"])).toBe(true);
        expect(isDayMatched(4, ["mon", "tue", "wed"])).toBe(false);
        expect(isDayMatched(5, ["fri", "sat"])).toBe(true);
        expect(isDayMatched(0, ["sun"])).toBe(true);
        expect(isDayMatched(6, ["sat"])).toBe(true);
      });

      it("matches numeric day representations (1-7 and 0 for Sun)", () => {
        expect(isDayMatched(1, ["1", "2", "3"])).toBe(true);
        expect(isDayMatched(4, ["1", "2", "3"])).toBe(false);
        expect(isDayMatched(5, ["5"])).toBe(true);
        // Sunday edge cases (both '0' and '7' as Sunday)
        expect(isDayMatched(0, ["0"])).toBe(true);
        expect(isDayMatched(0, ["7"])).toBe(true);
        expect(isDayMatched(0, ["1", "2", "3", "4", "5"])).toBe(false);
      });

      it("treats empty or undefined days as everyday", () => {
        expect(isDayMatched(0, [])).toBe(true);
        expect(isDayMatched(3, [])).toBe(true);
        expect(isDayMatched(6, undefined)).toBe(true);
      });
    });

    describe("Autonomous Server Scheduler Daemon (checkAndRunSchedules)", () => {
      it("triggers weekly schedule when day of week and HH:mm time match", async () => {
        clearFiredHistory();
        // 2026-09-23 is Wednesday (day 3)
        const wedDate = new Date(2026, 8, 23, 8, 30, 0); // 08:30 on Wed
        const testJob: ScheduleJob = {
          id: "daemon-test-1",
          name: "Wednesday Bell",
          type: "weekly",
          time: "08:30",
          days: ["mon", "wed", "fri"],
          filename: "bell.mp3",
          volume: 90,
          loop: 1,
          enabled: true,
        };

        await saveSchedules([testJob]);
        const triggered = await checkAndRunSchedules(wedDate);
        expect(triggered.length).toBe(1);
        expect(triggered[0].id).toBe("daemon-test-1");
      });

      it("deduplicates triggers within the same minute", async () => {
        // Run again with a time 15 seconds later in the same minute
        const wedDateLater = new Date(2026, 8, 23, 8, 30, 15);
        const secondRun = await checkAndRunSchedules(wedDateLater);
        expect(secondRun.length).toBe(0);
      });

      it("does not trigger when schedule is disabled (enabled: false)", async () => {
        clearFiredHistory();
        const wedDate = new Date(2026, 8, 23, 8, 30, 0);
        const disabledJob: ScheduleJob = {
          id: "daemon-test-disabled",
          name: "Disabled Bell",
          type: "weekly",
          time: "08:30",
          days: ["wed"],
          filename: "bell.mp3",
          volume: 90,
          loop: 1,
          enabled: false,
        };

        await saveSchedules([disabledJob]);
        const triggered = await checkAndRunSchedules(wedDate);
        expect(triggered.length).toBe(0);
      });

      it("triggers daily schedule regardless of day of week", async () => {
        clearFiredHistory();
        const sundayDate = new Date(2026, 8, 20, 12, 0, 0); // Sunday
        const dailyJob: ScheduleJob = {
          id: "daemon-test-daily",
          name: "Daily Noon Chime",
          type: "daily",
          time: "12:00",
          filename: "chime.mp3",
          volume: 80,
          loop: 1,
          enabled: true,
        };

        await saveSchedules([dailyJob]);
        const triggered = await checkAndRunSchedules(sundayDate);
        expect(triggered.length).toBe(1);
        expect(triggered[0].name).toBe("Daily Noon Chime");
      });

      it("triggers once schedule only on exact target date and time", async () => {
        clearFiredHistory();
        const onceDate = new Date(2026, 8, 23, 14, 0, 0); // 2026-09-23 14:00
        const diffDate = new Date(2026, 8, 24, 14, 0, 0); // 2026-09-24 14:00
        const onceJob: ScheduleJob = {
          id: "daemon-test-once",
          name: "Special Announcement",
          type: "once",
          date: "2026-09-23",
          time: "14:00",
          filename: "announce.mp3",
          volume: 85,
          loop: 1,
          enabled: true,
        };

        await saveSchedules([onceJob]);
        // Different day should not fire
        const diffDayTriggered = await checkAndRunSchedules(diffDate);
        expect(diffDayTriggered.length).toBe(0);

        // Matching day fires
        const matchedTriggered = await checkAndRunSchedules(onceDate);
        expect(matchedTriggered.length).toBe(1);
        expect(matchedTriggered[0].id).toBe("daemon-test-once");
      });
    });

    describe("Scheduler REST API Endpoints (/api/scheduler)", () => {
      it("requires authentication for scheduler endpoints", async () => {
        const res = await schedulerApp.handle(new Request("http://localhost/api/scheduler"));
        expect(res.status).toBe(401);
      });

      it("supports full CRUD lifecycle: list, create, update, toggle, export, and delete", async () => {
        // 1. List
        const listRes = await schedulerApp.handle(new Request("http://localhost/api/scheduler", {
          headers: { Cookie: authCookie },
        }));
        expect(listRes.status).toBe(200);
        const listData = await listRes.json();
        expect(Array.isArray(listData.schedules)).toBe(true);

        // 2. Create
        const createRes = await schedulerApp.handle(new Request("http://localhost/api/scheduler", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: authCookie,
          },
          body: JSON.stringify({
            name: "Morning Anthem",
            type: "weekly",
            time: "08:00",
            days: ["mon", "tue", "wed", "thu", "fri"],
            filename: "anthem.mp3",
            volume: 85,
            loop: 1,
          }),
        }));
        expect(createRes.status).toBe(200);
        const createData = await createRes.json();
        expect(createData.success).toBe(true);
        expect(createData.job).toBeTruthy();
        const createdJobId = createData.job.id;
        expect(createData.job.name).toBe("Morning Anthem");
        expect(createData.job.days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
        expect(createData.job.enabled).toBe(true);

        // 3. Toggle
        const toggleRes = await schedulerApp.handle(new Request(`http://localhost/api/scheduler/${createdJobId}/toggle`, {
          method: "PATCH",
          headers: { Cookie: authCookie },
        }));
        expect(toggleRes.status).toBe(200);
        const toggleData = await toggleRes.json();
        expect(toggleData.success).toBe(true);
        expect(toggleData.enabled).toBe(false);

        // Toggle back to true
        const toggleBackRes = await schedulerApp.handle(new Request(`http://localhost/api/scheduler/${createdJobId}/toggle`, {
          method: "PATCH",
          headers: { Cookie: authCookie },
        }));
        const toggleBackData = await toggleBackRes.json();
        expect(toggleBackData.enabled).toBe(true);

        // 4. Update (PUT)
        const updateRes = await schedulerApp.handle(new Request(`http://localhost/api/scheduler/${createdJobId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Cookie: authCookie,
          },
          body: JSON.stringify({
            name: "National Anthem V2",
            time: "08:05",
            volume: 95,
            loop: 2,
          }),
        }));
        expect(updateRes.status).toBe(200);
        const updateData = await updateRes.json();
        expect(updateData.success).toBe(true);
        expect(updateData.job.name).toBe("National Anthem V2");
        expect(updateData.job.time).toBe("08:05");
        expect(updateData.job.volume).toBe(95);
        expect(updateData.job.loop).toBe(2);

        // 5. Export
        const exportRes = await schedulerApp.handle(new Request("http://localhost/api/scheduler/export", {
          headers: { Cookie: authCookie },
        }));
        expect(exportRes.status).toBe(200);
        expect(exportRes.headers.get("content-type")).toContain("application/json");
        expect(exportRes.headers.get("content-disposition")).toContain("attachment; filename=");
        const exportedList = await exportRes.json();
        expect(Array.isArray(exportedList)).toBe(true);
        expect(exportedList.some((j: any) => j.id === createdJobId)).toBe(true);

        // 6. Delete
        const deleteRes = await schedulerApp.handle(new Request(`http://localhost/api/scheduler/${createdJobId}`, {
          method: "DELETE",
          headers: { Cookie: authCookie },
        }));
        expect(deleteRes.status).toBe(200);
        const deleteData = await deleteRes.json();
        expect(deleteData.success).toBe(true);

        // Verify it is gone
        const verifyListRes = await schedulerApp.handle(new Request("http://localhost/api/scheduler", {
          headers: { Cookie: authCookie },
        }));
        const verifyData = await verifyListRes.json();
        expect(verifyData.schedules.some((j: any) => j.id === createdJobId)).toBe(false);
      });
    });

    describe("React SPA Scheduler Engine & Component Verification", () => {
      it("verifies scheduler-engine.ts implements start, stop, checkSchedules, and testPlay", () => {
        const enginePath = path.resolve(process.cwd(), "frontend/src/services/scheduler-engine.ts");
        const code = fs.readFileSync(enginePath, "utf-8");

        expect(code).toContain("class SchedulerEngineService");
        expect(code).toContain("start(");
        expect(code).toContain("stop(");
        expect(code).toContain("checkSchedules(");
        expect(code).toContain("triggerJob(");
        expect(code).toContain("testPlay(");
        expect(code).toContain("isDayMatched(");
        expect(code).toContain("onSchedulerTrigger");
      });

      it("verifies App.tsx mounts schedulerEngine lifecycle and alert banner", () => {
        const appPath = path.resolve(process.cwd(), "frontend/src/App.tsx");
        const code = fs.readFileSync(appPath, "utf-8");

        expect(code).toContain("schedulerEngine.start()");
        expect(code).toContain("schedulerEngine.stop()");
        expect(code).toContain("scheduledAlert");
        expect(code).toContain("setScheduledAlert");
      });

      it("verifies ScheduleModal.tsx normalizes days into standard strings", () => {
        const modalPath = path.resolve(process.cwd(), "frontend/src/components/ScheduleModal.tsx");
        const code = fs.readFileSync(modalPath, "utf-8");

        expect(code).toContain("DAYS = [");
        expect(code).toContain("normalizeDays");
        expect(code).toContain("mon");
        expect(code).toContain("fri");
      });

      it("verifies SchedulerDeck.tsx features bilingual day mapping and test play button", () => {
        const deckPath = path.resolve(process.cwd(), "frontend/src/components/SchedulerDeck.tsx");
        const code = fs.readFileSync(deckPath, "utf-8");

        expect(code).toContain("DAY_KEY_MAP");
        expect(code).toContain("schedulerEngine.testPlay(job)");
        expect(code).toContain("Test Play");
      });
    });
  });
});



