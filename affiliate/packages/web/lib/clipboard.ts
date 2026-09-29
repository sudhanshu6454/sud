/*
 * Copy to the clipboard (client components only). Uses the async clipboard
 * API and falls back to a hidden <textarea> + execCommand('copy') where it
 * is missing or refused (older browsers, some webviews). The "Copied" for
 * 2s feedback lives with the caller (components/creator/links/useCopy.ts,
 * components/onboarding/JoinDone.tsx).
 */

/** How long a button reads "Copied" after a copy (design handover). */
export const COPIED_MS = 2000;

/** Copy text; resolves true when it reached the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
