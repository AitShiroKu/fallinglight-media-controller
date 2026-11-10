/**
 * YouTube Routes — Fetch/download audio or video from YouTube URLs.
 */
import { Elysia, t } from "elysia";
import { authGuard, requireAuth } from "../middleware/auth-guard";
import { UPLOADS_DIR, sanitizeFilename, sanitizeFolderName, loadSettings } from "../utils/storage";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const ytJobs = new Map<string, { status: "downloading" | "success" | "error"; progress: number; filename?: string; error?: string; format?: "mp3" | "mp4" }>();

export interface YouTubeSearchResult {
  id: string;
  title: string;
  channel: string;
  duration: number | null;
  thumbnail: string;
  url: string;
  isLive: boolean;
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const SEARCH_MAX_QUERY = 200;
export const SEARCH_MAX_LIMIT = 30;
const SEARCH_TIMEOUT_MS = 45_000;

/** Convert yt-dlp `--flat-playlist -J` output into a compact result list. */
export function parseSearchResults(raw: string): YouTubeSearchResult[] {
  const start = raw.indexOf("{");
  if (start < 0) return [];
  let data: any;
  try {
    data = JSON.parse(raw.slice(start));
  } catch {
    return [];
  }
  const entries: any[] = Array.isArray(data?.entries) ? data.entries : [];
  const results: YouTubeSearchResult[] = [];
  for (const e of entries) {
    const id = typeof e?.id === "string" ? e.id : "";
    if (!VIDEO_ID_RE.test(id)) continue; // skip channels/playlists
    results.push({
      id,
      title: String(e.title ?? id),
      channel: String(e.channel ?? e.uploader ?? ""),
      duration: typeof e.duration === "number" ? e.duration : null,
      thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${id}`,
      isLive: e.live_status === "is_live",
    });
  }
  return results;
}

export const youtubeRoutes = requireAuth(
  new Elysia({ prefix: "/api/youtube" }).use(authGuard),
  (app) => app

  // GET /api/youtube/search?q=...&limit=12 — Search YouTube via yt-dlp
  .get("/search", async ({ query, set }) => {
    const q = (query.q ?? "").trim();
    if (!q) {
      set.status = 400;
      return { error: "Missing search query" };
    }
    if (q.length > SEARCH_MAX_QUERY) {
      set.status = 400;
      return { error: "Search query too long" };
    }
    const limit = Math.min(Math.max(parseInt(query.limit ?? "12", 10) || 12, 1), SEARCH_MAX_LIMIT);

    // Arguments are passed as argv (no shell), so the query cannot inject commands.
    const proc = Bun.spawn(
      ["yt-dlp", "--flat-playlist", "-J", "--no-warnings", `ytsearch${limit}:${q}`],
      { stdout: "pipe", stderr: "pipe" }
    );
    const timer = setTimeout(() => proc.kill(), SEARCH_TIMEOUT_MS);
    try {
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (code !== 0) {
        set.status = 502;
        return { error: `Search failed: ${err.trim().split("\n").pop() ?? "yt-dlp error"}` };
      }
      return { query: q, results: parseSearchResults(out) };
    } catch (e: any) {
      set.status = 500;
      return { error: e?.message ?? "Search failed" };
    } finally {
      clearTimeout(timer);
    }
  }, {
    query: t.Object({
      q: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })

  // GET /api/youtube/progress/:id — Poll job progress
  .get("/progress/:id", ({ params, set }) => {
    const job = ytJobs.get(params.id);
    if (!job) {
      set.status = 404;
      return { error: "Job not found" };
    }
    return job;
  })

  // POST /api/youtube/download — Start YouTube download (MP3 audio or MP4 video+audio)
  .post("/download", async ({ body, set }) => {
    const { url, format, folder } = body;
    const isMp4 = format === "mp4";
    const targetExt = isMp4 ? "mp4" : "mp3";
    const safeFolder = sanitizeFolderName(folder || "");

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      set.status = 400;
      return { error: "Invalid URL" };
    }

    const targetDir = safeFolder ? resolve(UPLOADS_DIR, safeFolder) : UPLOADS_DIR;
    if (!targetDir.startsWith(UPLOADS_DIR)) {
      set.status = 400;
      return { error: "Invalid target folder" };
    }

    try {
      const jobId = crypto.randomUUID();
      ytJobs.set(jobId, { status: "downloading", progress: 0, format: isMp4 ? "mp4" : "mp3" });

      // Start the entire process in background so API returns immediately
      (async () => {
        try {
          // 1. Get video title with remote-components enabled for JS challenges
          const titleProc = Bun.spawn(["yt-dlp", "--remote-components", "ejs:github", "--print", "%(title)s", url]);
          const titleExitCode = await titleProc.exited;
          let title = "youtube_media";
          if (titleExitCode === 0) {
            const fetchedTitle = (await new Response(titleProc.stdout).text()).trim();
            if (fetchedTitle) title = fetchedTitle;
          }

          await mkdir(targetDir, { recursive: true });
          const safeTitle = sanitizeFilename(title) || "youtube_media";
          const outputFilename = safeFolder ? `${safeFolder}/${safeTitle}.${targetExt}` : `${safeTitle}.${targetExt}`;
          const outputPath = join(targetDir, `${safeTitle}.%(ext)s`);

          // 2. Load YouTube quality setting
          const settings = await loadSettings();
          const quality = settings.ytQuality ?? "0";

          // 3. Build yt-dlp arguments conditionally based on format
          const dlArgs = [
            "yt-dlp",
            "--remote-components",
            "ejs:github",
            "--newline",
          ];

          if (isMp4) {
            dlArgs.push(
              "-f",
              "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
              "--merge-output-format",
              "mp4",
              "-o",
              outputPath,
              url
            );
          } else {
            dlArgs.push(
              "-x",
              "--audio-format",
              "mp3",
              "--audio-quality",
              quality,
              "-o",
              outputPath,
              url
            );
          }

          const downloadProc = Bun.spawn(dlArgs, { stdout: "pipe", stderr: "pipe" });

          // Concurrently read stderr to prevent pipe buffer deadlock
          const stderrPromise = new Response(downloadProc.stderr).text();

          // Read stdout stream with line buffering
          const reader = downloadProc.stdout.getReader();
          const decoder = new TextDecoder();
          let lineBuffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            lineBuffer += decoder.decode(value, { stream: true });
            const lines = lineBuffer.split("\n");
            lineBuffer = lines.pop() ?? "";

            for (const line of lines) {
              const match = line.match(/\[download\]\s+([\d.]+)%/);
              if (match) {
                const prog = parseFloat(match[1]);
                if (!isNaN(prog)) {
                  ytJobs.set(jobId, { status: "downloading", progress: prog, format: isMp4 ? "mp4" : "mp3" });
                }
              }
            }
          }

          if (lineBuffer) {
            const match = lineBuffer.match(/\[download\]\s+([\d.]+)%/);
            if (match) {
              const prog = parseFloat(match[1]);
              if (!isNaN(prog)) {
                ytJobs.set(jobId, { status: "downloading", progress: prog, format: isMp4 ? "mp4" : "mp3" });
              }
            }
          }
          
          const exitCode = await downloadProc.exited;
          const finalFilePath = join(targetDir, `${safeTitle}.${targetExt}`);
          const fileExists = await Bun.file(finalFilePath).exists();

          // yt-dlp might return non-zero exit code on warning but still create the file successfully
          if (exitCode === 0 || fileExists) {
            ytJobs.set(jobId, { status: "success", progress: 100, filename: outputFilename, format: isMp4 ? "mp4" : "mp3" });
          } else {
            const errorText = await stderrPromise;
            ytJobs.set(jobId, { status: "error", progress: 0, error: `Download failed: ${errorText.trim()}`, format: isMp4 ? "mp4" : "mp3" });
          }
        } catch (err: any) {
          ytJobs.set(jobId, { status: "error", progress: 0, error: err.message, format: isMp4 ? "mp4" : "mp3" });
        } finally {
          // Clean up job from memory after 30 minutes
          setTimeout(() => {
            ytJobs.delete(jobId);
          }, 30 * 60 * 1000);
        }
      })();

      return { jobId, title: "Downloading..." };
    } catch (err: any) {
      set.status = 500;
      return { error: err.message ?? "An unexpected error occurred" };
    }
  }, {
    body: t.Object({
      url: t.String(),
      format: t.Optional(t.Union([t.Literal("mp3"), t.Literal("mp4")])),
      folder: t.Optional(t.String()),
    }),
  })
);
