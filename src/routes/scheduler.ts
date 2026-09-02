/**
 * Scheduler Routes — CRUD + import/export for scheduled playback jobs.
 */
import { Elysia, t } from "elysia";
import { authGuard, requireAuth } from "../middleware/auth-guard";
import {
  loadSchedules,
  saveSchedules,
  generateId,
  type ScheduleJob,
} from "../utils/storage";

export const schedulerRoutes = requireAuth(
  new Elysia({ prefix: "/api/scheduler" }).use(authGuard),
  (app) => app

  // GET /api/scheduler — List all schedules
  .get("/", async () => {
    const schedules = await loadSchedules();
    return { schedules };
  })

  // POST /api/scheduler — Add a new schedule
  .post("/", async ({ body }) => {
    const schedules = await loadSchedules();

    const newJob: ScheduleJob = {
      id: generateId(),
      name: body.name,
      type: body.type as "once" | "daily" | "weekly",
      time: body.time,
      date: body.date,
      days: body.days,
      filename: body.filename,
      volume: body.volume ?? 80,
      loop: body.loop ?? 1,
      enabled: true,
    };

    schedules.push(newJob);
    await saveSchedules(schedules);
    return { success: true, job: newJob };
  }, {
    body: t.Object({
      name: t.String(),
      type: t.String(),
      time: t.String(),
      date: t.Optional(t.String()),
      days: t.Optional(t.Array(t.String())),
      filename: t.String(),
      volume: t.Optional(t.Number()),
      loop: t.Optional(t.Number()),
    }),
  })

  // PUT /api/scheduler/:id — Update a schedule
  .put("/:id", async ({ params, body, set }) => {
    const schedules = await loadSchedules();
    const index = schedules.findIndex((j) => j.id === params.id);

    if (index === -1) {
      set.status = 404;
      return { error: "Schedule not found" };
    }

    const targetType = (body.type as "once" | "daily" | "weekly") ?? schedules[index].type;
    let newDate: string | undefined = undefined;
    let newDays: string[] | undefined = undefined;

    if (targetType === "once") {
      newDate = body.date !== undefined ? body.date : schedules[index].date;
    } else if (targetType === "weekly") {
      newDays = body.days !== undefined ? body.days : schedules[index].days;
    }

    schedules[index] = {
      ...schedules[index],
      name: body.name ?? schedules[index].name,
      type: targetType,
      time: body.time ?? schedules[index].time,
      date: newDate,
      days: newDays,
      filename: body.filename ?? schedules[index].filename,
      volume: body.volume ?? schedules[index].volume,
      loop: body.loop ?? schedules[index].loop,
    };

    await saveSchedules(schedules);
    return { success: true, job: schedules[index] };
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      name: t.Optional(t.String()),
      type: t.Optional(t.String()),
      time: t.Optional(t.String()),
      date: t.Optional(t.String()),
      days: t.Optional(t.Array(t.String())),
      filename: t.Optional(t.String()),
      volume: t.Optional(t.Number()),
      loop: t.Optional(t.Number()),
    }),
  })

  // DELETE /api/scheduler/:id — Delete a schedule
  .delete("/:id", async ({ params, set }) => {
    let schedules = await loadSchedules();
    const before = schedules.length;
    schedules = schedules.filter((j) => j.id !== params.id);

    if (schedules.length === before) {
      set.status = 404;
      return { error: "Schedule not found" };
    }

    await saveSchedules(schedules);
    return { success: true };
  }, {
    params: t.Object({ id: t.String() }),
  })

  // PATCH /api/scheduler/:id/toggle — Toggle enabled/disabled
  .patch("/:id/toggle", async ({ params, set }) => {
    const schedules = await loadSchedules();
    const job = schedules.find((j) => j.id === params.id);

    if (!job) {
      set.status = 404;
      return { error: "Schedule not found" };
    }

    job.enabled = !job.enabled;
    await saveSchedules(schedules);
    return { success: true, enabled: job.enabled };
  }, {
    params: t.Object({ id: t.String() }),
  })

  // GET /api/scheduler/export — Export schedules as JSON download
  .get("/export", async ({ set }) => {
    const schedules = await loadSchedules();
    const json = JSON.stringify(schedules, null, 2);

    set.headers["content-type"] = "application/json";
    set.headers["content-disposition"] =
      `attachment; filename="schedules_${new Date().toISOString().slice(0, 10)}.json"`;

    return json;
  })

  // POST /api/scheduler/import — Import schedules from JSON
  .post("/import", async ({ body, set }) => {
    const file = body.file;

    if (!file) {
      set.status = 400;
      return { error: "No file provided" };
    }

    try {
      const text = await file.text();
      const imported = JSON.parse(text);

      if (!Array.isArray(imported)) {
        set.status = 400;
        return { error: "Invalid format — expected JSON array" };
      }

      // Validate and assign new IDs to avoid conflicts
      const existingSchedules = await loadSchedules();
      const newJobs: ScheduleJob[] = imported.map((item: any) => ({
        id: generateId(),
        name: item.name || "Imported",
        type: item.type || "daily",
        time: item.time || "07:50",
        date: item.date || undefined,
        days: item.days || undefined,
        filename: item.filename || "",
        volume: item.volume ?? 80,
        loop: item.loop ?? 1,
        enabled: item.enabled ?? true,
      }));

      const merged = [...existingSchedules, ...newJobs];
      await saveSchedules(merged);

      return { success: true, imported: newJobs.length, total: merged.length };
    } catch (e) {
      set.status = 400;
      return { error: "Failed to parse JSON file" };
    }
  }, {
    body: t.Object({
      file: t.File(),
    }),
  })
);
