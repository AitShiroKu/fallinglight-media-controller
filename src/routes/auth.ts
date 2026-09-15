/**
 * Auth Routes — Login, logout, and session check endpoints.
 */
import { Elysia, t } from "elysia";
import { createSessionToken, authGuard } from "../middleware/auth-guard";

/** Credentials from environment variables with defaults */
const VALID_USER = process.env.APP_USER ?? "admin";
const VALID_PASS = process.env.APP_PASS ?? "cptw@2468";

/** Simple in-memory rate limiter for login */
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count++;
  return true;
}

export const authRoutes = new Elysia({ prefix: "/api/auth" })

  // POST /api/auth/login
  .post("/login", async ({ body, cookie, set, request }) => {
    const ip = request.headers.get("x-forwarded-for")
      ?? request.headers.get("x-real-ip")
      ?? "unknown";

    if (!checkRateLimit(ip)) {
      set.status = 429;
      return { success: false, message: "Too many login attempts. Try again later." };
    }

    const { username, password } = body;

    if (username === VALID_USER && password === VALID_PASS) {
      loginAttempts.delete(ip);
      const token = await createSessionToken();

      cookie.session.set({
        value: token,
        httpOnly: true,
        maxAge: 10 * 365 * 24 * 60 * 60, // 10 years (persistent login)
        path: "/",
        sameSite: "lax",
      });

      return { success: true, message: "Login successful", token };
    }

    set.status = 401;
    return { success: false, message: "Invalid username or password" };
  }, {
    body: t.Object({
      username: t.String(),
      password: t.String(),
    }),
  })

  // POST /api/auth/logout
  .post("/logout", ({ cookie }) => {
    cookie.session.remove();
    return { success: true, message: "Logged out" };
  })

  // GET /api/auth/check
  .use(authGuard)
  .get("/check", ({ isAuthenticated, cookie }) => {
    return {
      authenticated: isAuthenticated,
      token: isAuthenticated ? (cookie?.session?.value ?? null) : null,
    };
  });
