/**
 * Streaming Routes — WebSocket-based cross-session remote control.
 *
 * Enables a Controller (mobile/laptop) to remotely control audio playback
 * on multiple Receivers (desktop PCs) in real-time via WebSocket message relay.
 * Supports multiple receivers per room for multi-speaker setups.
 */
import { Elysia, t } from "elysia";
import { authGuard, requireAuth, isValidToken } from "../middleware/auth-guard";

// ── In-memory streaming state ────────────────────────────────
interface StreamingRoom {
  id: string;
  createdAt: number;
  controllerWs: any | null;
  receivers: Set<any>;          // Multiple receivers supported
}

let activeRoom: StreamingRoom | null = null;

function generateRoomId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── WebSocket helpers ────────────────────────────────────────
function pruneDeadSockets() {
  if (!activeRoom) return;
  for (const receiver of Array.from(activeRoom.receivers)) {
    if (!receiver || receiver.readyState !== 1) {
      try { receiver.close(); } catch {}
      activeRoom.receivers.delete(receiver);
    }
  }
  if (activeRoom.controllerWs && activeRoom.controllerWs.readyState !== 1) {
    activeRoom.controllerWs = null;
  }
}

function sendTo(ws: any, data: object) {
  try {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  } catch {
    // ignore send errors
  }
}

function broadcastToReceivers(data: object) {
  if (!activeRoom) return;
  pruneDeadSockets();
  for (const receiver of activeRoom.receivers) {
    sendTo(receiver, data);
  }
}

function relayToController(data: object) {
  if (activeRoom?.controllerWs) {
    if (activeRoom.controllerWs.readyState === 1) {
      sendTo(activeRoom.controllerWs, data);
    } else {
      activeRoom.controllerWs = null;
    }
  }
}

// ── Public API (no auth — for receiver page) ────────────────
const streamingPublicApi = new Elysia({ prefix: "/api/streaming" })

  // GET /api/streaming/status — Check streaming state (public)
  .get("/status", () => {
    pruneDeadSockets();
    if (!activeRoom) {
      return { active: false };
    }
    return {
      active: true,
      roomId: activeRoom.id,
      controllerConnected: !!(activeRoom.controllerWs && activeRoom.controllerWs.readyState === 1),
      receiverCount: activeRoom.receivers.size,
    };
  });

// ── Protected API routes (require auth) ──────────────────────
const streamingApi = requireAuth(
  new Elysia({ prefix: "/api/streaming" }).use(authGuard),
  (app) => app

  // POST /api/streaming/enable — Create or get streaming room
  .post("/enable", () => {
    pruneDeadSockets();
    if (!activeRoom) {
      activeRoom = {
        id: generateRoomId(),
        createdAt: Date.now(),
        controllerWs: null,
        receivers: new Set(),
      };
    }
    return {
      success: true,
      roomId: activeRoom.id,
      receiverCount: activeRoom.receivers.size,
    };
  })

  // POST /api/streaming/disable — Tear down streaming room
  .post("/disable", () => {
    if (activeRoom) {
      for (const receiver of activeRoom.receivers) {
        sendTo(receiver, { type: "room_closed" });
        try { receiver.close(); } catch {}
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
        receiverCount: 0,
        receivers: [],
        uptimeSeconds: 0,
        serverTime: new Date().toISOString(),
      };
    }
    return {
      active: true,
      roomId: activeRoom.id,
      createdAt: activeRoom.createdAt,
      uptimeSeconds: Math.floor((Date.now() - activeRoom.createdAt) / 1000),
      controllerConnected: !!(activeRoom.controllerWs && activeRoom.controllerWs.readyState === 1),
      receiverCount: activeRoom.receivers.size,
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
      receiverCount: activeRoom ? activeRoom.receivers.size : 0,
      controllerConnected: !!(activeRoom?.controllerWs && activeRoom.controllerWs.readyState === 1),
    };
  })
);

// ── WebSocket route (no auth middleware — uses query token) ──
const streamingWs = new Elysia()
  .ws("/ws/streaming", {
    query: t.Object({
      role: t.String(),
      room: t.String(),
      token: t.Optional(t.String()),
    }),

    async open(ws) {
      const { role, room, token } = ws.data.query;

      // Validate room exists
      if (!activeRoom || activeRoom.id !== room) {
        sendTo(ws, { type: "error", message: "Room not found or expired" });
        ws.close();
        return;
      }

      // Controller must have valid auth token (query param or secure cookie)
      if (role === "controller") {
        let authToken = token || ws.data.cookie?.session?.value;
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

        if (activeRoom.controllerWs && activeRoom.controllerWs !== ws) {
          try {
            activeRoom.controllerWs.close();
          } catch {}
        }

        activeRoom.controllerWs = ws;
        sendTo(ws, { type: "connected", role: "controller" });

        // Prune any dead receivers before notifying
        pruneDeadSockets();

        // Notify all existing receivers
        for (const receiver of activeRoom.receivers) {
          sendTo(receiver, { type: "peer_connected", role: "controller" });
        }
        // Tell controller how many receivers are connected
        if (activeRoom.receivers.size > 0) {
          sendTo(ws, { type: "peer_connected", role: "receiver", count: activeRoom.receivers.size });
        }

      } else if (role === "receiver") {
        // Receiver doesn't need auth (convenience for PR room PC)
        activeRoom.receivers.add(ws);
        sendTo(ws, { type: "connected", role: "receiver" });

        // Notify controller about new receiver
        if (activeRoom.controllerWs && activeRoom.controllerWs.readyState === 1) {
          sendTo(activeRoom.controllerWs, {
            type: "peer_connected",
            role: "receiver",
            count: activeRoom.receivers.size,
          });
          sendTo(ws, { type: "peer_connected", role: "controller" });
        }
      } else {
        sendTo(ws, { type: "error", message: "Invalid role" });
        ws.close();
      }
    },

    message(ws, message) {
      if (!activeRoom) return;

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
