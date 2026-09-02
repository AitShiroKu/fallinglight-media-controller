/**
 * File Routes — Upload, download, list, and delete media files.
 */
import { Elysia, t } from "elysia";
import { join } from "node:path";
import { authGuard, requireAuth } from "../middleware/auth-guard";
import {
  listFiles,
  deleteFile,
  saveUploadedFile,
  isAllowedExtension,
  UPLOADS_DIR,
  sanitizeFilename,
} from "../utils/storage";

export const fileRoutes = requireAuth(
  new Elysia({ prefix: "/api/files" }).use(authGuard),
  (app) => app

  // GET /api/files — List all uploaded files
  .get("/", async () => {
    const files = await listFiles();
    return { files };
  })

  // POST /api/files/upload — Upload media file(s)
  .post("/upload", async ({ body, set }) => {
    const file = body.file;

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

      const savedName = await saveUploadedFile(f);
      results.push(savedName);
    }

    return { success: true, files: results };
  }, {
    body: t.Object({
      file: t.Union([t.File(), t.Files(), t.Array(t.File()), t.Any()]),
    }),
  })

  // DELETE /api/files/:filename — Delete a file
  .delete("/:filename", async ({ params, set }) => {
    const success = await deleteFile(params.filename);
    if (!success) {
      set.status = 404;
      return { error: "File not found" };
    }
    return { success: true };
  }, {
    params: t.Object({
      filename: t.String(),
    }),
  })
);
