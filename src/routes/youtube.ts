/**
 * YouTube Routes — Fetch/download audio from YouTube URLs.
 */
import { Elysia, t } from "elysia";
import { authGuard, requireAuth } from "../middleware/auth-guard";
import { UPLOADS_DIR, sanitizeFilename, loadSettings } from "../utils/storage";
import { join } from "node:path";

const ytJobs = new Map<string, { status: "downloading" | "success" | "error"; progress: number; filename?: string; error?: string }>();

export const youtubeRoutes = requireAuth(
  new Elysia({ prefix: "/api/youtube" }).use(authGuard),
  (app) => app

  // GET /api/youtube/progress/:id — Poll job progress
  .get("/progress/:id", ({ params, set }) => {
    const job = ytJobs.get(params.id);
    if (!job) {
      set.status = 404;
      return { error: "Job not found" };
    }
    return job;
  })

  // POST /api/youtube/download — Start YouTube audio download
  .post("/download", async ({ body, set }) => {
    const { url } = body;

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      set.status = 400;
      return { error: "Invalid URL" };
    }

    try {
      const jobId = crypto.randomUUID();
      ytJobs.set(jobId, { status: "downloading", progress: 0 });

      // Start the entire process in background so API returns immediately
      (async () => {
        try {
          // 1. Get video title with remote-components enabled for JS challenges
          const titleProc = Bun.spawn(["yt-dlp", "--remote-components", "ejs:github", "--print", "%(title)s", url]);
          const titleExitCode = await titleProc.exited;
          let title = "youtube_audio";
          if (titleExitCode === 0) {
            const fetchedTitle = (await new Response(titleProc.stdout).text()).trim();
            if (fetchedTitle) title = fetchedTitle;
          }

          const safeTitle = sanitizeFilename(title) || "youtube_audio";
          const outputFilename = `${safeTitle}.mp3`;
          const outputPath = join(UPLOADS_DIR, `${safeTitle}.%(ext)s`);

          // 2. Load YouTube quality setting
          const settings = await loadSettings();
          const quality = settings.ytQuality ?? "0";

          // 3. Start download
          const downloadProc = Bun.spawn([
            "yt-dlp",
            "--remote-components",
            "ejs:github",
            "--newline",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            quality,
            "-o",
            outputPath,
            url,
          ], { stdout: "pipe", stderr: "pipe" });

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
                  ytJobs.set(jobId, { status: "downloading", progress: prog });
                }
              }
            }
          }

          if (lineBuffer) {
            const match = lineBuffer.match(/\[download\]\s+([\d.]+)%/);
            if (match) {
              const prog = parseFloat(match[1]);
              if (!isNaN(prog)) {
                ytJobs.set(jobId, { status: "downloading", progress: prog });
              }
            }
          }
          
          const exitCode = await downloadProc.exited;
          const finalFilePath = join(UPLOADS_DIR, outputFilename);
          const fileExists = await Bun.file(finalFilePath).exists();

          // yt-dlp might return non-zero exit code on warning but still create the file successfully
          if (exitCode === 0 || fileExists) {
            ytJobs.set(jobId, { status: "success", progress: 100, filename: outputFilename });
          } else {
            const errorText = await stderrPromise;
            ytJobs.set(jobId, { status: "error", progress: 0, error: `Download failed: ${errorText.trim()}` });
          }
        } catch (err: any) {
          ytJobs.set(jobId, { status: "error", progress: 0, error: err.message });
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
    }),
  })
);
