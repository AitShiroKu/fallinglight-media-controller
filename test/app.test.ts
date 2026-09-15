import { describe, it, expect, beforeAll } from "bun:test";
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
} from "../src/utils/storage";

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

