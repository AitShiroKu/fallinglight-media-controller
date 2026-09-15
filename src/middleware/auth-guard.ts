/**
 * Auth Guard — Session validation middleware for ElysiaJS.
 *
 * Uses a signed session token stored in a cookie.
 * Validates on every protected API request.
 */
import { Elysia } from "elysia";

/** Session secret from env or default */
const SESSION_SECRET = process.env.SESSION_SECRET ?? "fallinglight-session-2468";

/** Generate a session token with proper cryptographic signing */
export async function createSessionToken(): Promise<string> {
  const payload = `admin:${Date.now()}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(SESSION_SECRET);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC", cryptoKey, encoder.encode(payload)
  );
  const sigHex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  return `${payload}:${sigHex.slice(0, 32)}`;
}

/** Validate a session token */
export async function isValidToken(token: unknown): Promise<boolean> {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(":");
  if (parts.length < 3) return false;
  const timestamp = parseInt(parts[1], 10);
  if (isNaN(timestamp) || timestamp <= 0) return false;
  // Persistent login: no timeout / expiration check
  // Verify HMAC signature
  const payload = parts.slice(0, 2).join(":");
  const sigPart = parts.slice(2).join(":");
  const encoder = new TextEncoder();
  const keyData = encoder.encode(SESSION_SECRET);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC", cryptoKey, encoder.encode(payload)
  );
  const expectedSig = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  return sigPart === expectedSig;
}

/** Auth guard plugin — derive `isAuthenticated` on every request */
export const authGuard = new Elysia({ name: "auth-guard" })
  .derive({ as: "global" }, async ({ cookie }) => {
    const token = cookie?.session?.value;
    return {
      isAuthenticated: await isValidToken(token),
    };
  });

/**
 * Require auth — wraps routes in a guard that checks isAuthenticated.
 * Usage: wrap your route definitions in the callback.
 */
export function requireAuth<T extends Elysia<any, any, any, any, any, any, any>>(
  app: T,
  routes: (app: T) => any
): any {
  return (app as any).guard({
    beforeHandle: ({ isAuthenticated, set }: { isAuthenticated: boolean; set: any }) => {
      if (!isAuthenticated) {
        set.status = 401;
        return { error: "Unauthorized — please log in" };
      }
    }
  }, routes as any);
}
