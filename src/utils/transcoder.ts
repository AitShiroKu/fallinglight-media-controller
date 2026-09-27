/**
 * Video Transcoder Utility — On-demand video downscaling and caching.
 * Allows streaming receivers to independently request different resolutions
 * (1080p, 720p, 480p, 360p) without affecting controller or other receivers.
 */
import { stat, mkdir, unlink, rename } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { UPLOADS_DIR, isVideoFile, sanitizeFilePath } from "./storage";

export const RENDITIONS_CACHE_DIR = join(UPLOADS_DIR, ".renditions");

export const SUPPORTED_RESOLUTIONS: Record<string, number> = {
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
  "360p": 360,
};

const activeJobs = new Map<string, Promise<string>>();

export interface RenditionResult {
  path: string;
  isRendition: boolean;
  resolution: string;
}

export async function getVideoRenditionPath(
  relativeFilePath: string,
  targetRes: string
): Promise<RenditionResult | null> {
  const sanitized = sanitizeFilePath(relativeFilePath);
  if (!sanitized) return null;

  const fullSourcePath = resolve(UPLOADS_DIR, sanitized);
  const baseUploads = resolve(UPLOADS_DIR);

  // Security check: ensure path is strictly within uploads directory
  if (!fullSourcePath.startsWith(baseUploads)) {
    return null;
  }

  // Ensure it is a valid video file
  if (!isVideoFile(fullSourcePath)) {
    return null;
  }

  // Ensure source file exists on disk
  let sourceStat;
  try {
    sourceStat = await stat(fullSourcePath);
  } catch {
    return null;
  }

  const normalizedRes = (targetRes || "original").toLowerCase();

  // If original or auto or unsupported resolution, return original file path
  const targetHeight = SUPPORTED_RESOLUTIONS[normalizedRes];
  if (!targetHeight || normalizedRes === "original" || normalizedRes === "auto") {
    return { path: fullSourcePath, isRendition: false, resolution: "original" };
  }

  await mkdir(RENDITIONS_CACHE_DIR, { recursive: true });

  // Generate deterministic cache key based on file content signature and target resolution
  const hashKey = `${sanitized}:${sourceStat.size}:${sourceStat.mtimeMs}:${normalizedRes}`;
  const hash = createHash("md5").update(hashKey).digest("hex").slice(0, 16);
  const safeBase = basename(sanitized)
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9_\-\u0E00-\u0E7F]/g, "_");
  const cacheFileName = `${safeBase}_${normalizedRes}_${hash}.mp4`;
  const cacheFilePath = join(RENDITIONS_CACHE_DIR, cacheFileName);

  // Check if cache already exists and has non-zero size
  try {
    const cacheStat = await stat(cacheFilePath);
    if (cacheStat.size > 0) {
      return { path: cacheFilePath, isRendition: true, resolution: normalizedRes };
    }
  } catch {}

  // If a transcode job is already running for this file+resolution, await it
  if (activeJobs.has(cacheFilePath)) {
    try {
      const readyPath = await activeJobs.get(cacheFilePath)!;
      return {
        path: readyPath,
        isRendition: readyPath !== fullSourcePath,
        resolution: readyPath !== fullSourcePath ? normalizedRes : "original",
      };
    } catch {
      return { path: fullSourcePath, isRendition: false, resolution: "original" };
    }
  }

  // Start FFmpeg transcode job
  const job = (async () => {
    const tempPath = `${cacheFilePath}.tmp_${Date.now()}.mp4`;
    try {
      const proc = Bun.spawn(
        [
          "ffmpeg",
          "-i",
          fullSourcePath,
          "-vf",
          `scale=-2:${targetHeight}`,
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "25",
          "-c:a",
          "copy",
          "-movflags",
          "+faststart",
          tempPath,
          "-y",
        ],
        {
          stderr: "ignore",
          stdout: "ignore",
        }
      );

      const exitCode = await proc.exited;
      if (exitCode === 0) {
        await rename(tempPath, cacheFilePath);
        return cacheFilePath;
      } else {
        console.warn(`[Transcoder] FFmpeg exited with code ${exitCode} for ${sanitized}`);
        try {
          await unlink(tempPath);
        } catch {}
        return fullSourcePath;
      }
    } catch (err) {
      console.warn(`[Transcoder] Error transcoding ${sanitized}:`, err);
      try {
        await unlink(tempPath);
      } catch {}
      return fullSourcePath;
    } finally {
      activeJobs.delete(cacheFilePath);
    }
  })();

  activeJobs.set(cacheFilePath, job);

  const finalPath = await job;
  return {
    path: finalPath,
    isRendition: finalPath !== fullSourcePath,
    resolution: finalPath !== fullSourcePath ? normalizedRes : "original",
  };
}
