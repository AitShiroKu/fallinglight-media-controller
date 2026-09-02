import { describe, it, expect, beforeAll } from "bun:test";
import { Elysia } from "elysia";
import { authRoutes } from "../src/routes/auth";
import { fileRoutes } from "../src/routes/files";
import { schedulerRoutes } from "../src/routes/scheduler";
import { settingsRoutes } from "../src/routes/settings";
import { streamingRoutes } from "../src/routes/streaming";
import { createSessionToken, isValidToken } from "../src/middleware/auth-guard";
import { sanitizeFilename, isAllowedExtension, initStorage } from "../src/utils/storage";

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

  it("validates allowed media extensions", () => {
    expect(isAllowedExtension("test.mp3")).toBe(true);
    expect(isAllowedExtension("test.wav")).toBe(true);
    expect(isAllowedExtension("test.flac")).toBe(true);
    expect(isAllowedExtension("test.mp4")).toBe(true);
    expect(isAllowedExtension("test.exe")).toBe(false);
    expect(isAllowedExtension("test.php")).toBe(false);
    expect(isAllowedExtension("test.js")).toBe(false);
  });
});

describe("Auth Guard & Cryptographic Tokens", () => {
  it("creates and validates signed session tokens", async () => {
    const token = await createSessionToken();
    expect(typeof token).toBe("string");
    expect(await isValidToken(token)).toBe(true);
  });

  it("rejects invalid or tampered tokens", async () => {
    expect(await isValidToken("")).toBe(false);
    expect(await isValidToken(null)).toBe(false);
    expect(await isValidToken("admin:12345:fakehash")).toBe(false);
    expect(await isValidToken("admin:0:00000000000000000000000000000000")).toBe(false);
  });
});

describe("API Integration", () => {
  const app = new Elysia()
    .use(authRoutes)
    .use(fileRoutes)
    .use(schedulerRoutes)
    .use(settingsRoutes)
    .use(streamingRoutes);

  it("rejects unauthenticated requests to protected routes", async () => {
    const res = await app.handle(new Request("http://localhost/api/files"));
    expect(res.status).toBe(401);
  });

  it("authenticates valid credentials and sets session cookie", async () => {
    const res = await app.handle(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "cptw@2468" }),
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    const cookie = res.headers.get("set-cookie");
    expect(cookie).toContain("session=");
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
});
