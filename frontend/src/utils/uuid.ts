/**
 * Generates an RFC 4122 v4 compliant UUID string.
 * Supports both Secure Contexts (HTTPS, localhost) and standard HTTP domains (e.g. http://aszn.online:6140).
 *
 * 1. Uses native crypto.randomUUID() when in a Secure Context (window.isSecureContext === true).
 * 2. Uses crypto.getRandomValues() to generate an RFC 4122 v4 UUID with proper version (4) and variant bits.
 *    crypto.getRandomValues is available in all modern browsers even in non-secure HTTP contexts.
 * 3. Fallback for environments where Web Cryptography is unavailable (UI element IDs only).
 */
export function generateUUID(): string {
  // 1. Native randomUUID (Secure Contexts: HTTPS, localhost)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {}
  }

  // 2. RFC 4122 v4 UUID via crypto.getRandomValues (available in non-secure HTTP contexts)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      // Set version to 0100 (v4)
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      // Set variant to 10xxxxxx (RFC 4122)
      bytes[8] = (bytes[8] & 0x3f) | 0x80;

      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    } catch {}
  }

  // 3. Fallback pseudo-UUID (for track list keys only, never for auth tokens)
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}${s4()}-${s4()}-4${s4().substring(1)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${s4().substring(1)}-${s4()}${s4()}${s4()}`;
}
