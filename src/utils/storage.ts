/**
 * Storage utilities — File system helpers for uploads and data persistence.
 */
import { readdir, stat, unlink, mkdir, readFile, writeFile, exists, rename, rm } from "node:fs/promises";
import { join, extname, resolve, basename } from "node:path";

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

const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".webm", ".mkv", ".avi",
]);

export function isVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(extname(filename).toLowerCase());
}

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

/** Sanitize a folder name or subpath */
export function sanitizeFolderName(folder: string): string {
  if (!folder) return "";
  const parts = folder.split(/[/\\]+/).map(p =>
    p.replace(/[^a-zA-Z0-9_\-.\u0E00-\u0E7F\u3000-\u9FFF ]/g, "_")
     .replace(/\.{2,}/g, ".")
     .trim()
  ).filter(p => p && p !== ".." && p !== ".");
  return parts.join("/");
}

/** Sanitize a relative file path (folder + filename) */
export function sanitizeFilePath(filePath: string): string {
  if (!filePath) return "";
  const parts = filePath.split(/[/\\]+/).map(p =>
    p.replace(/[^a-zA-Z0-9_\-.\u0E00-\u0E7F\u3000-\u9FFF ]/g, "_")
     .replace(/\.{2,}/g, ".")
     .trim()
  ).filter(p => p && p !== ".." && p !== ".");
  return parts.join("/");
}

/** Check if a file extension is allowed */
export function isAllowedExtension(filename: string): boolean {
  return ALLOWED_EXTENSIONS.has(extname(filename).toLowerCase());
}

// ── File Operations ───────────────────────────────────────

export interface FileInfo {
  name: string;
  folder: string;
  path: string;           // relative path from uploads/ (e.g. "Song.mp3" or "Announcements/Bell.wav")
  size: number;
  sizeFormatted: string;
  extension: string;
  isVideo: boolean;
  modifiedAt: string;
}

export interface FolderInfo {
  name: string;
  path: string;           // relative path from uploads/
  fileCount: number;
  totalSizeBytes: number;
  totalSizeFormatted: string;
}

export async function listFiles(targetFolder: string = ""): Promise<FileInfo[]> {
  try {
    const files: FileInfo[] = [];
    const cleanFolder = sanitizeFolderName(targetFolder);
    const startDir = cleanFolder ? resolve(UPLOADS_DIR, cleanFolder) : UPLOADS_DIR;

    if (!startDir.startsWith(UPLOADS_DIR) || !(await exists(startDir))) {
      return [];
    }

    async function walk(dir: string, currentRelFolder: string) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          const nextRel = currentRelFolder ? `${currentRelFolder}/${entry.name}` : entry.name;
          await walk(fullPath, nextRel);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (ALLOWED_EXTENSIONS.has(ext)) {
            const info = await stat(fullPath);
            const relPath = currentRelFolder ? `${currentRelFolder}/${entry.name}` : entry.name;
            files.push({
              name: entry.name,
              folder: currentRelFolder,
              path: relPath,
              size: info.size,
              sizeFormatted: formatBytes(info.size),
              extension: ext,
              isVideo: VIDEO_EXTENSIONS.has(ext),
              modifiedAt: info.mtime.toISOString(),
            });
          }
        }
      }
    }

    await walk(startDir, cleanFolder);
    return files.sort((a, b) => a.path.localeCompare(b.path));
  } catch {
    return [];
  }
}

export async function listFolders(): Promise<FolderInfo[]> {
  try {
    const folders: FolderInfo[] = [];

    async function scanFolders(dir: string, currentRel: string) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const folderRel = currentRel ? `${currentRel}/${entry.name}` : entry.name;
          const fullPath = join(dir, entry.name);

          // Get files inside this specific subfolder tree
          const subFiles = await listFiles(folderRel);
          const totalBytes = subFiles.reduce((acc, f) => acc + f.size, 0);

          folders.push({
            name: entry.name,
            path: folderRel,
            fileCount: subFiles.length,
            totalSizeBytes: totalBytes,
            totalSizeFormatted: formatBytes(totalBytes),
          });

          await scanFolders(fullPath, folderRel);
        }
      }
    }

    await scanFolders(UPLOADS_DIR, "");
    return folders.sort((a, b) => a.path.localeCompare(b.path));
  } catch {
    return [];
  }
}

export async function createFolder(folderPath: string): Promise<boolean> {
  const safe = sanitizeFolderName(folderPath);
  if (!safe) return false;
  const targetDir = resolve(UPLOADS_DIR, safe);
  if (!targetDir.startsWith(UPLOADS_DIR)) return false;
  await mkdir(targetDir, { recursive: true });
  return true;
}

export async function deleteFolder(folderPath: string): Promise<boolean> {
  const safe = sanitizeFolderName(folderPath);
  if (!safe) return false;
  const targetDir = resolve(UPLOADS_DIR, safe);
  if (!targetDir.startsWith(UPLOADS_DIR) || targetDir === UPLOADS_DIR) return false;
  try {
    await rm(targetDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export async function deleteFile(filePath: string): Promise<boolean> {
  const safe = sanitizeFilePath(filePath);
  if (!safe) return false;
  const fullpath = resolve(UPLOADS_DIR, safe);
  if (!fullpath.startsWith(UPLOADS_DIR) || fullpath === UPLOADS_DIR) return false;
  try {
    await unlink(fullpath);
    return true;
  } catch {
    return false;
  }
}

export async function moveFile(sourceRelativePath: string, targetFolder: string): Promise<{ success: boolean; newPath?: string }> {
  const safeSource = sanitizeFilePath(sourceRelativePath);
  const safeTargetFolder = sanitizeFolderName(targetFolder);
  if (!safeSource) return { success: false };

  const sourceFile = resolve(UPLOADS_DIR, safeSource);
  if (!sourceFile.startsWith(UPLOADS_DIR) || !(await exists(sourceFile))) {
    return { success: false };
  }

  const fileName = basename(sourceFile);
  const targetDir = safeTargetFolder ? resolve(UPLOADS_DIR, safeTargetFolder) : UPLOADS_DIR;
  if (!targetDir.startsWith(UPLOADS_DIR)) return { success: false };

  await mkdir(targetDir, { recursive: true });
  const destinationFile = resolve(targetDir, fileName);
  if (!destinationFile.startsWith(UPLOADS_DIR)) return { success: false };

  await rename(sourceFile, destinationFile);
  const newRelPath = safeTargetFolder ? `${safeTargetFolder}/${fileName}` : fileName;
  return { success: true, newPath: newRelPath };
}

export async function saveUploadedFile(file: File, folder: string = ""): Promise<string> {
  const safeFolder = sanitizeFolderName(folder);
  const targetDir = safeFolder ? resolve(UPLOADS_DIR, safeFolder) : UPLOADS_DIR;
  if (!targetDir.startsWith(UPLOADS_DIR)) throw new Error("Invalid target directory");

  await mkdir(targetDir, { recursive: true });
  const safeName = sanitizeFilename(file.name);
  const filepath = resolve(targetDir, safeName);
  const buffer = await file.arrayBuffer();
  await Bun.write(filepath, buffer);
  return safeFolder ? `${safeFolder}/${safeName}` : safeName;
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
