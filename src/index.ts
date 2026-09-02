/**
 * FallingLight Media Controller — Web Server Entry Point
 * 
 * Bun + ElysiaJS server that serves the web UI, manages media files,
 * and stores scheduler configurations. Listens on 0.0.0.0 for LAN access.
 */
import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { authRoutes } from "./routes/auth";
import { fileRoutes } from "./routes/files";
import { schedulerRoutes } from "./routes/scheduler";
import { settingsRoutes } from "./routes/settings";
import { youtubeRoutes } from "./routes/youtube";
import { streamingRoutes } from "./routes/streaming";
import { initStorage, UPLOADS_DIR } from "./utils/storage";
import { join } from "node:path";

const PORT = process.env.PORT ?? 6140;
const PROJECT_ROOT = import.meta.dir.replace(/[/\\]src$/, "");

// Initialize storage directories
await initStorage();

const app = new Elysia()

  // Serve static frontend from public/
  .use(staticPlugin({
    assets: join(PROJECT_ROOT, "public"),
    prefix: "/",
  }))

  // Serve uploaded media files from uploads/ with Unicode & Range support
  .get("/uploads/*", async ({ params, set }) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(params["*"]);
    } catch {
      set.status = 400;
      return "Invalid filename";
    }

    // Prevent directory traversal
    if (decoded.includes("..") || decoded.includes("/") || decoded.includes("\\")) {
      set.status = 400;
      return "Invalid filename";
    }
    const filePath = join(UPLOADS_DIR, decoded);
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const mimeTypes: Record<string, string> = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".wma": "audio/x-ms-wma",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mkv": "video/x-matroska",
        ".avi": "video/x-msvideo",
      };
      const ext = decoded.slice(decoded.lastIndexOf(".")).toLowerCase();
      const contentType = file.type || mimeTypes[ext] || "application/octet-stream";

      set.headers["content-type"] = contentType;
      set.headers["access-control-allow-origin"] = "*";
      set.headers["accept-ranges"] = "bytes";
      return file;
    }
    set.status = 404;
    return "Not Found";
  })

  // Serve streaming receiver page
  .get("/stream", async () => {
    const html = Bun.file(join(PROJECT_ROOT, "public", "stream.html"));
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  })

  // API routes
  .use(authRoutes)
  .use(fileRoutes)
  .use(schedulerRoutes)
  .use(settingsRoutes)
  .use(youtubeRoutes)
  .use(streamingRoutes)

  // Health check
  .get("/api/health", () => ({ status: "ok", time: new Date().toISOString() }))

  // Listen on all interfaces for LAN access
  .listen({
    port: PORT,
    hostname: "0.0.0.0",
  });

console.log(`
╔══════════════════════════════════════════════════╗
║   🎛  FallingLight Media Controller              ║
║   ───────────────────────────────────────────    ║
║   Server running at:                             ║
║     Local:   http://localhost:${PORT}               ║
║     LAN:     http://<your-ip>:${PORT}               ║
║                                                  ║
║   Login: admin / cptw@2468                       ║
╚══════════════════════════════════════════════════╝
`);

export type App = typeof app;
// reload cache: 1
