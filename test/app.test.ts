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
