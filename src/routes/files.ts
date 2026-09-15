/**
 * File Routes — Upload, download, list, and delete media files (audio & video).
 */
import { Elysia, t } from "elysia";
import { join } from "node:path";
import { authGuard, requireAuth } from "../middleware/auth-guard";
import {
  listFiles,
  listFolders,
  createFolder,
  deleteFolder,
  deleteFile,
  moveFile,
  saveUploadedFile,
  isAllowedExtension,
  sanitizeFolderName,
} from "../utils/storage";

export const fileRoutes = requireAuth(
  new Elysia({ prefix: "/api/files" }).use(authGuard),
  (app) => app

  // GET /api/files — List files and folders
  .get("/", async ({ query }) => {
    const folder = (query?.folder as string) || "";
    const files = await listFiles(folder);
    const folders = await listFolders();
    return { files, folders };
  }, {
    query: t.Optional(t.Object({
      folder: t.Optional(t.String()),
    })),
  })

  // POST /api/files/upload — Upload media file(s) into root or specific folder
  .post("/upload", async ({ body, set }) => {
    const file = body.file;
    const folder = (body.folder as string) || "";

    if (!file) {
      set.status = 400;
      return { error: "No file provided" };
    }

    // Handle single file or array
    const files = Array.isArray(file) ? file : [file];
    const results: string[] = [];

    for (const f of files) {
      if (!isAllowedExtension(f.name)) {
        set.status = 400;
        return {
          error: `File type not allowed: ${f.name}. Supported: mp3, mp4, wav, flac, ogg, m4a, aac, wma, avi, mkv, webm`,
        };
      }

      try {
        const savedPath = await saveUploadedFile(f, folder);
        results.push(savedPath);
      } catch (err: any) {
        set.status = 500;
        return { error: err.message || "Failed to save file" };
      }
    }

    return { success: true, files: results };
  }, {
    body: t.Object({
      file: t.Union([t.File(), t.Files(), t.Array(t.File()), t.Any()]),
      folder: t.Optional(t.String()),
    }),
  })

  // POST /api/files/folder — Create a new folder
  .post("/folder", async ({ body, set }) => {
    const { name, parent } = body;
    const folderPath = parent ? `${parent}/${name}` : name;
    const success = await createFolder(folderPath);
    if (!success) {
      set.status = 400;
      return { error: "Invalid folder name or path" };
    }
    const folders = await listFolders();
    return { success: true, folders };
  }, {
    body: t.Object({
      name: t.String(),
      parent: t.Optional(t.String()),
    }),
  })

  // DELETE /api/files/folder/* — Delete a folder and its contents
  .delete("/folder/*", async ({ params, set }) => {
    let folderPath = params["*"];
    try {
      folderPath = decodeURIComponent(folderPath);
    } catch {}

    const success = await deleteFolder(folderPath);
    if (!success) {
      set.status = 400;
      return { error: "Cannot delete root or non-existent folder" };
    }
    const folders = await listFolders();
    return { success: true, folders };
  })

  // POST /api/files/move — Move file to another folder
  .post("/move", async ({ body, set }) => {
    const { filename, targetFolder } = body;
    const result = await moveFile(filename, targetFolder || "");
    if (!result.success) {
      set.status = 400;
      return { error: "Failed to move file" };
    }
    return { success: true, newPath: result.newPath };
  }, {
    body: t.Object({
      filename: t.String(),
      targetFolder: t.String(),
    }),
  })

  // DELETE /api/files/* — Delete a file (supports root or nested paths)
  .delete("/*", async ({ params, set }) => {
    let rawPath = params["*"];
    try {
      rawPath = decodeURIComponent(rawPath);
    } catch {}

    const success = await deleteFile(rawPath);
    if (!success) {
      set.status = 404;
      return { error: "File not found" };
    }
    return { success: true };
  })
);
