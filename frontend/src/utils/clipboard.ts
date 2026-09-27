/**
 * Safe clipboard copy utility supporting both Secure Contexts (navigator.clipboard)
 * and non-secure HTTP contexts (document.execCommand fallback).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 1. Try modern Async Clipboard API (available in Secure Contexts: HTTPS, localhost)
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }

  // 2. Fallback for insecure HTTP contexts (e.g. http://aszn.online:6140)
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textArea);
    return success;
  } catch (err) {
    console.warn('[Clipboard] Copy fallback failed:', err);
    return false;
  }
}
