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
import { startSchedulerDaemon } from "./services/scheduler-daemon";
import { initStorage, UPLOADS_DIR } from "./utils/storage";
import { join, resolve } from "node:path";

const PORT = process.env.PORT ?? 6140;
const PROJECT_ROOT = import.meta.dir.replace(/[/\\]src$/, "");

// Initialize storage directories
await initStorage();

const DIST_DIR = join(PROJECT_ROOT, "dist");
const PUBLIC_DIR = join(PROJECT_ROOT, "public");
const hasDist = await Bun.file(join(DIST_DIR, "index.html")).exists();

const app = new Elysia()

  // Serve static assets from dist/assets (React 19 + Vite SPA) if built
  .use(
    hasDist
      ? staticPlugin({
          assets: join(DIST_DIR, "assets"),
          prefix: "/assets",
        })
      : (a) => a
  )

  // Serve static fallback from public/ (stream receiver assets & legacy files)
  .use(
    staticPlugin({
      assets: PUBLIC_DIR,
      prefix: "/",
    })
  )

  // Serve main SPA application root
  .get("/", async () => {
    const filePath = hasDist ? join(DIST_DIR, "index.html") : join(PUBLIC_DIR, "index.html");
    return new Response(Bun.file(filePath), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache, no-store, must-revalidate",
        "pragma": "no-cache",
        "expires": "0",
      },
    });
  })

  // SPA Route Fallbacks
  .get("/player", async () => {
    const filePath = hasDist ? join(DIST_DIR, "index.html") : join(PUBLIC_DIR, "index.html");
    return new Response(Bun.file(filePath), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache, no-store, must-revalidate",
        "pragma": "no-cache",
        "expires": "0",
      },
    });
  })
  .get("/files", async () => {
    const filePath = hasDist ? join(DIST_DIR, "index.html") : join(PUBLIC_DIR, "index.html");
    return new Response(Bun.file(filePath), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache, no-store, must-revalidate",
        "pragma": "no-cache",
        "expires": "0",
      },
    });
  })
  .get("/schedule", async () => {
    const filePath = hasDist ? join(DIST_DIR, "index.html") : join(PUBLIC_DIR, "index.html");
    return new Response(Bun.file(filePath), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache, no-store, must-revalidate",
        "pragma": "no-cache",
        "expires": "0",
      },
    });
  })
  .get("/settings", async () => {
    const filePath = hasDist ? join(DIST_DIR, "index.html") : join(PUBLIC_DIR, "index.html");
    return new Response(Bun.file(filePath), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache, no-store, must-revalidate",
        "pragma": "no-cache",
        "expires": "0",
      },
    });
  })

  // Serve uploaded media files from uploads/ with Unicode, nested folders & Range support
  .get("/uploads/*", async ({ params, set }) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(params["*"]);
    } catch {
      set.status = 400;
      return "Invalid filename";
    }

    // Prevent directory traversal
    if (decoded.includes("..") || decoded.startsWith("/") || decoded.includes("\\")) {
      set.status = 400;
      return "Invalid filename";
    }
    const filePath = resolve(UPLOADS_DIR, decoded);
    if (!filePath.startsWith(UPLOADS_DIR)) {
      set.status = 403;
      return "Forbidden";
    }
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

  // Serve streaming receiver pages:
  // /stream       -> Both audio and video
  // /stream/audio -> Audio only
  // /stream/video -> Video only
  .get("/stream", async () => {
    const html = Bun.file(join(PROJECT_ROOT, "public", "stream.html"));
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  })
  .get("/stream/audio", async () => {
    const html = Bun.file(join(PROJECT_ROOT, "public", "stream.html"));
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  })
  .get("/stream/video", async () => {
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
  .get("/api/health", () => ({ status: "ok", time: new Date().toISOString() }));

if (import.meta.main) {
  // Start autonomous background scheduler daemon
  startSchedulerDaemon();

  // Listen on all interfaces for LAN access
  app.listen({
    port: PORT,
    hostname: "0.0.0.0",
  });

  console.log(`
╔══════════════════════════════════════════════════╗
║   [*] FallingLight Media Controller              ║
║   ───────────────────────────────────────────    ║
║   Server running at:                             ║
║     Local:   http://localhost:${PORT}               ║
║     LAN:     http://<your-ip>:${PORT}               ║
║                                                  ║
║   Login: admin / cptw@2468                       ║
╚══════════════════════════════════════════════════╝
`);
}

export { app };
export type App = typeof app;
// reload cache: 1
