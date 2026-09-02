/**
 * Settings Routes — Fetch and update system settings.
 */
import { Elysia, t } from "elysia";
import { authGuard, requireAuth } from "../middleware/auth-guard";
import { loadSettings, saveSettings } from "../utils/storage";

export const settingsRoutes = requireAuth(
  new Elysia({ prefix: "/api/settings" }).use(authGuard),
  (app) => app

  // GET /api/settings — Retrieve app settings
  .get("/", async () => {
    const settings = await loadSettings();
    return settings;
  })

  // POST /api/settings — Update app settings
  .post("/", async ({ body, set }) => {
    await saveSettings(body);
    return { success: true };
  }, {
    body: t.Object({
      defaultVolume: t.Number(),
      fadeDuration: t.Number(),
      duckVolume: t.Number(),
      duckDuration: t.Number(),
      autoAdvance: t.Boolean(),
      ytQuality: t.String(),
      warnOnClose: t.Boolean(),
    }),
  })
);
