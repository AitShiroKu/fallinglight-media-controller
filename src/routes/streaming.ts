/**
 * Streaming Routes — WebSocket-based cross-session remote control.
 *
 * Enables a Controller (mobile/laptop) to remotely control audio playback
 * on multiple Receivers (desktop PCs) in real-time via WebSocket message relay.
 * Supports multiple receivers per room for multi-speaker setups.
 */
import { Elysia, t } from "elysia";
import { authGuard, requireAuth, isValidToken } from "../middleware/auth-guard";
import { getVideoRenditionPath } from "../utils/transcoder";

// ── In-memory streaming state ────────────────────────────────
interface StreamingRoom {
  id: string;
  createdAt: number;
  controllerWs: any | null;
  receivers: Set<any>;          // Multiple receivers supported
}

let activeRoom: StreamingRoom | null = null;
const standbyReceivers = new Set<any>();

function generateRoomId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── WebSocket helpers ────────────────────────────────────────
function isSocketAlive(ws: any): boolean {
  if (!ws) return false;
  const state = ws.readyState ?? ws.raw?.readyState;
  if (state === undefined) return typeof ws.send === "function";
  return state === 1; // 1 = OPEN
}

function pruneDeadSockets() {
  for (const receiver of Array.from(standbyReceivers)) {
    if (!isSocketAlive(receiver)) {
      try { receiver.close(); } catch {}
      standbyReceivers.delete(receiver);
    }
  }
  if (!activeRoom) return;
  for (const receiver of Array.from(activeRoom.receivers)) {
    if (!isSocketAlive(receiver)) {
      try { receiver.close(); } catch {}
      activeRoom.receivers.delete(receiver);
    }
  }
  if (activeRoom.controllerWs && !isSocketAlive(activeRoom.controllerWs)) {
    activeRoom.controllerWs = null;
  }
}

function sendTo(ws: any, data: object) {
  try {
    if (ws && isSocketAlive(ws)) {
      ws.send(JSON.stringify(data));
    }
  } catch {
    // ignore send errors
  }
}

export function broadcastToReceivers(data: object) {
  if (!activeRoom) return;
  pruneDeadSockets();
  for (const receiver of activeRoom.receivers) {
    sendTo(receiver, data);
  }
}

export function relayToController(data: object) {
  if (activeRoom?.controllerWs) {
    if (activeRoom.controllerWs.readyState === 1) {
      sendTo(activeRoom.controllerWs, data);
    } else {
      activeRoom.controllerWs = null;
    }
  }
}

export function ensureStreamingRoom(): StreamingRoom {
  pruneDeadSockets();
  if (!activeRoom) {
    activeRoom = {
      id: generateRoomId(),
      createdAt: Date.now(),
      controllerWs: null,
      receivers: new Set(),
    };
  }

  // Auto-migrate any speaker PCs waiting in the standby pool
  for (const ws of Array.from(standbyReceivers)) {
    if (isSocketAlive(ws)) {
      activeRoom.receivers.add(ws);
      sendTo(ws, {
        type: "room_ready",
        roomId: activeRoom.id,
        role: "receiver",
      });
    }
    standbyReceivers.delete(ws);
  }

  return activeRoom;
}

// ── Public API (no auth — for receiver page) ────────────────
const streamingPublicApi = new Elysia({ prefix: "/api/streaming" })

  // GET /api/streaming/status — Check streaming state (public)
  .get("/status", () => {
    pruneDeadSockets();
    if (!activeRoom) {
      return {
        active: false,
        standbyCount: standbyReceivers.size,
        receiverCount: standbyReceivers.size,
        controllerConnected: false,
      };
    }
    return {
      active: true,
      roomId: activeRoom.id,
      controllerConnected: !!(activeRoom.controllerWs && isSocketAlive(activeRoom.controllerWs)),
      receiverCount: activeRoom.receivers.size,
      standbyCount: standbyReceivers.size,
    };
  })

  // GET /api/streaming/video-rendition — Dynamic rendition transcoding and streaming
  .get(
    "/video-rendition",
    async ({ query, set }) => {
      const file = query.file;
      const res = query.res || "original";
      if (!file) {
        set.status = 400;
        return { error: "Missing 'file' parameter" };
      }
      const rendition = await getVideoRenditionPath(file, res);
      if (!rendition) {
        set.status = 404;
        return { error: "Video file not found or invalid" };
      }
      set.headers["Accept-Ranges"] = "bytes";
      set.headers["Content-Type"] = rendition.mimeType || "video/mp4";
      return Bun.file(rendition.path);
    },
    {
      query: t.Object({
        file: t.String(),
        res: t.Optional(t.String()),
      }),
    }
  );

// ── Protected API routes (require auth) ──────────────────────
const streamingApi = requireAuth(
  new Elysia({ prefix: "/api/streaming" }).use(authGuard),
  (app) => app

  // POST /api/streaming/enable — Create or get streaming room
  .post("/enable", () => {
    const room = ensureStreamingRoom();
    return {
      success: true,
      roomId: room.id,
      receiverCount: room.receivers.size,
    };
  })

  // POST /api/streaming/disable — Tear down streaming room
  .post("/disable", () => {
    if (activeRoom) {
      // Gracefully move active receivers back to standby pool so they don't disconnect
      for (const receiver of activeRoom.receivers) {
        if (isSocketAlive(receiver)) {
          sendTo(receiver, { type: "room_closed", standby: true });
          standbyReceivers.add(receiver);
        }
      }
      if (activeRoom.controllerWs) {
        sendTo(activeRoom.controllerWs, { type: "room_closed" });
        try { activeRoom.controllerWs.close(); } catch {}
      }
      activeRoom = null;
    }
    return { success: true };
  })

  // GET /api/streaming/debug — Detailed diagnostics for active room and connections
  .get("/debug", () => {
    pruneDeadSockets();
    if (!activeRoom) {
      return {
        active: false,
        roomId: null,
        controllerConnected: false,
        receiverCount: standbyReceivers.size,
        standbyCount: standbyReceivers.size,
        receivers: Array.from(standbyReceivers).map((r: any, idx: number) => ({
          index: idx + 1,
          readyState: r.readyState ?? r.raw?.readyState ?? 1,
          remoteAddress: r.remoteAddress || "standby",
        })),
        uptimeSeconds: 0,
        serverTime: new Date().toISOString(),
      };
    }
    return {
      active: true,
      roomId: activeRoom.id,
      createdAt: activeRoom.createdAt,
      uptimeSeconds: Math.floor((Date.now() - activeRoom.createdAt) / 1000),
      controllerConnected: !!(activeRoom.controllerWs && isSocketAlive(activeRoom.controllerWs)),
      receiverCount: activeRoom.receivers.size,
      standbyCount: standbyReceivers.size,
      receivers: Array.from(activeRoom.receivers).map((r: any, idx: number) => ({
        index: idx + 1,
        readyState: r.readyState,
        remoteAddress: r.remoteAddress || "connected",
      })),
      serverTime: new Date().toISOString(),
    };
  })

  // POST /api/streaming/reset — Forcefully reset room, terminate zombie sockets, clear state
  .post("/reset", () => {
    for (const ws of Array.from(standbyReceivers)) {
      try { ws.close(); } catch {}
    }
    standbyReceivers.clear();

    if (activeRoom) {
      for (const receiver of activeRoom.receivers) {
        sendTo(receiver, { type: "room_closed", reason: "reset_requested" });
        try { receiver.close(); } catch {}
      }
      if (activeRoom.controllerWs) {
        sendTo(activeRoom.controllerWs, { type: "room_closed", reason: "reset_requested" });
        try { activeRoom.controllerWs.close(); } catch {}
      }
      activeRoom = null;
    }
    return { success: true, message: "Streaming room and all sessions cleared successfully." };
  })

  // POST /api/streaming/clean-dead — Prune zombie sockets
  .post("/clean-dead", () => {
    pruneDeadSockets();
    return {
      success: true,
      receiverCount: activeRoom ? activeRoom.receivers.size : standbyReceivers.size,
      standbyCount: standbyReceivers.size,
      controllerConnected: !!(activeRoom?.controllerWs && activeRoom.controllerWs.readyState === 1),
    };
  })
);

// ── WebSocket route (no auth middleware — uses query token) ──
const streamingWs = new Elysia()
  .ws("/ws/streaming", {
    query: t.Object({
      role: t.String(),
      room: t.Optional(t.String()),
      token: t.Optional(t.String()),
    }),

    async open(ws) {
      const { role, room, token } = ws.data.query;

      // Controller must have valid auth token (query param or secure cookie)
      if (role === "controller") {
        let authToken = token || ws.data.cookie?.session?.value;
        if (authToken && typeof authToken === "string" && authToken.includes("%3A")) {
          try { authToken = decodeURIComponent(authToken); } catch {}
        }
        if (!authToken && (ws.data as any)?.headers) {
          const rawCookie = (ws.data as any).headers?.cookie || (ws.data as any).headers?.get?.("cookie");
          if (rawCookie && typeof rawCookie === "string") {
            const m = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
            if (m) authToken = decodeURIComponent(m[1]);
          }
        }

        if (!(await isValidToken(authToken))) {
          sendTo(ws, { type: "error", message: "Unauthorized" });
          ws.close();
          return;
        }

        if (!activeRoom) {
          activeRoom = {
            id: (room && room !== "default" && room !== "auto") ? room : generateRoomId(),
            createdAt: Date.now(),
            controllerWs: null,
            receivers: new Set(),
          };
        }

        // Migrate any waiting standby receivers into active room
        for (const rWs of Array.from(standbyReceivers)) {
          if (isSocketAlive(rWs)) {
            activeRoom.receivers.add(rWs);
            sendTo(rWs, { type: "room_ready", roomId: activeRoom.id, role: "receiver" });
          }
          standbyReceivers.delete(rWs);
        }

        if (activeRoom.controllerWs && activeRoom.controllerWs !== ws) {
          try {
            activeRoom.controllerWs.close();
          } catch {}
        }

        activeRoom.controllerWs = ws;
        sendTo(ws, { type: "connected", role: "controller", roomId: activeRoom.id });

        pruneDeadSockets();

        // Notify all existing receivers that Controller is connected!
        for (const receiver of activeRoom.receivers) {
          sendTo(receiver, { type: "peer_connected", role: "controller" });
        }
        // Tell controller how many receivers are connected
        if (activeRoom.receivers.size > 0) {
          sendTo(ws, { type: "peer_connected", role: "receiver", count: activeRoom.receivers.size });
        }

      } else if (role === "receiver") {
        // Receiver connects (no auth required)
        if (activeRoom) {
          activeRoom.receivers.add(ws);
          sendTo(ws, { type: "connected", role: "receiver", roomId: activeRoom.id });

          // Notify controller about new receiver
          if (activeRoom.controllerWs && isSocketAlive(activeRoom.controllerWs)) {
            sendTo(activeRoom.controllerWs, {
              type: "peer_connected",
              role: "receiver",
              count: activeRoom.receivers.size,
            });
            sendTo(ws, { type: "peer_connected", role: "controller" });
          }
        } else {
          // No room yet — keep in standby pool so speaker PC remains ready!
          standbyReceivers.add(ws);
          sendTo(ws, {
            type: "connected",
            role: "receiver",
            standby: true,
            message: "Standby: Waiting for controller to open streaming room",
          });
        }
      } else {
        sendTo(ws, { type: "error", message: "Invalid role" });
        ws.close();
      }
    },

    message(ws, message) {
      let data: any;
      try {
        data = typeof message === "string" ? JSON.parse(message) : message;
      } catch {
        return;
      }

      if (data.type === "ping") {
        sendTo(ws, { type: "pong", time: Date.now() });
        return;
      }

      if (!activeRoom) return;

      const { role } = ws.data.query;

      if (role === "controller") {
        // Relay commands from Controller → all Receivers
        broadcastToReceivers(data);
      } else if (role === "receiver") {
        // Relay state updates from Receiver → Controller
        relayToController(data);
      }
    },

    close(ws) {
      standbyReceivers.delete(ws);
      if (!activeRoom) return;

      const { role } = ws.data.query;

      if (role === "controller" && activeRoom.controllerWs === ws) {
        activeRoom.controllerWs = null;
        // Notify all receivers
        broadcastToReceivers({ type: "peer_disconnected", role: "controller" });

      } else if (role === "receiver") {
        activeRoom.receivers.delete(ws);
        // Notify controller
        if (activeRoom.controllerWs) {
          sendTo(activeRoom.controllerWs, {
            type: "peer_disconnected",
            role: "receiver",
            count: activeRoom.receivers.size,
          });
        }
      }
    },
  });

// Combined export
export const streamingRoutes = new Elysia()
  .use(streamingPublicApi)
  .use(streamingApi)
  .use(streamingWs);
