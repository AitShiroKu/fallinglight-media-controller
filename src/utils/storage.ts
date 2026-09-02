/**
 * Storage utilities — File system helpers for uploads and data persistence.
 */
import { readdir, stat, unlink, mkdir, readFile, writeFile, exists } from "node:fs/promises";
import { join, extname } from "node:path";

const PROJECT_ROOT = import.meta.dir.replace(/[/\\]src[/\\]utils$/, "");
export const UPLOADS_DIR = join(PROJECT_ROOT, "uploads");
export const DATA_DIR = join(PROJECT_ROOT, "data");
export const SCHEDULES_FILE = join(DATA_DIR, "schedules.json");
export const SETTINGS_FILE = join(DATA_DIR, "settings.json");

export interface AppSettings {
  defaultVolume: number;
  fadeDuration: number;
  duckVolume: number;
  duckDuration: number;
  autoAdvance: boolean;
  ytQuality: string;
  warnOnClose: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultVolume: 0.8,
  fadeDuration: 1.5,
  duckVolume: 0.12,
  duckDuration: 300,
  autoAdvance: true,
  ytQuality: "0",
  warnOnClose: true,
};

const ALLOWED_EXTENSIONS = new Set([
  ".mp3", ".mp4", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".wma",
  ".avi", ".mkv", ".webm",
]);

/** Ensure required directories exist */
export async function initStorage(): Promise<void> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });
  if (!(await exists(SCHEDULES_FILE))) {
    await writeFile(SCHEDULES_FILE, "[]", "utf-8");
  }
  if (!(await exists(SETTINGS_FILE))) {
    await writeFile(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf-8");
  }
}

/** Sanitize a filename to prevent path traversal */
export function sanitizeFilename(name: string): string {
  const sanitized = name
    .replace(/[/\\]+/g, "_")
    .replace(/[^a-zA-Z0-9_\-.\u0E00-\u0E7F\u3000-\u9FFF ]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[_.\s]+|[_.\s]+$/g, "");
  return sanitized || "media_file";
}

/** Check if a file extension is allowed */
export function isAllowedExtension(filename: string): boolean {
  return ALLOWED_EXTENSIONS.has(extname(filename).toLowerCase());
}

// ── File Operations ───────────────────────────────────────

export interface FileInfo {
  name: string;
  size: number;
  sizeFormatted: string;
  extension: string;
  modifiedAt: string;
}

export async function listFiles(): Promise<FileInfo[]> {
  try {
    const entries = await readdir(UPLOADS_DIR);
    const files: FileInfo[] = [];

    for (const name of entries) {
      const filepath = join(UPLOADS_DIR, name);
      const info = await stat(filepath);
      if (info.isFile()) {
        files.push({
          name,
          size: info.size,
          sizeFormatted: formatBytes(info.size),
          extension: extname(name).toLowerCase(),
          modifiedAt: info.mtime.toISOString(),
        });
      }
    }

    return files.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function deleteFile(filename: string): Promise<boolean> {
  const filepath = join(UPLOADS_DIR, sanitizeFilename(filename));
  try {
    await unlink(filepath);
    return true;
  } catch {
    return false;
  }
}

export async function saveUploadedFile(file: File): Promise<string> {
  const safeName = sanitizeFilename(file.name);
  const filepath = join(UPLOADS_DIR, safeName);
  const buffer = await file.arrayBuffer();
  await Bun.write(filepath, buffer);
  return safeName;
}

// ── Schedule Operations ───────────────────────────────────

export interface ScheduleJob {
  id: string;
  name: string;
  type: "once" | "daily" | "weekly";
  time: string;       // HH:mm
  date?: string;      // YYYY-MM-DD (for once)
  days?: string[];    // ["mon","tue",...] (for weekly)
  filename: string;   // references uploads/ folder
  volume: number;
  loop: number;
  enabled: boolean;
}

export async function loadSchedules(): Promise<ScheduleJob[]> {
  try {
    const data = await readFile(SCHEDULES_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function saveSchedules(jobs: ScheduleJob[]): Promise<void> {
  await writeFile(SCHEDULES_FILE, JSON.stringify(jobs, null, 2), "utf-8");
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const data = await readFile(SETTINGS_FILE, "utf-8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Helpers ───────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + " " + sizes[i];
}
