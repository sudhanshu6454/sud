/**
 * SERVER-ONLY environment (no `server-only` package is installed, so the
 * guard is by convention: never import this module from a 'use client'
 * file — WEB_API_TOKEN must never be bundled for the browser).
 *
 *   API_BASE           origin of the v1 API as seen from the web server
 *                      (default http://localhost:3000). If unset and
 *                      NEXT_PUBLIC_API_BASE is an absolute URL, that is used.
 *   WEB_API_TOKEN      bearer JWT for a read-only role (publisher_analyst).
 *                      Never NEXT_PUBLIC_, never sent to the browser, never
 *                      attached to proxied browser requests.
 *   WEB_PLACEMENT_ID   uuid of the shop's own placement; appended as
 *                      placement_id to GET /v1/looks/:id so items carry links.
 */

const DEFAULT_API_BASE = 'http://localhost:3000';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stripSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Resolved at request time (process.env is read on every call, not at build). */
export function apiBase(): string {
  const explicit = process.env.API_BASE?.trim();
  if (explicit) return stripSlash(explicit);
  const pub = process.env.NEXT_PUBLIC_API_BASE?.trim();
  if (pub && isAbsoluteHttpUrl(pub)) return stripSlash(pub);
  return DEFAULT_API_BASE;
}

export function webApiToken(): string | null {
  const token = process.env.WEB_API_TOKEN?.trim();
  return token ? token : null;
}

/** null when unset or not a uuid — a malformed id is never sent to the API. */
export function webPlacementId(): string | null {
  const id = process.env.WEB_PLACEMENT_ID?.trim();
  return id && UUID_RE.test(id) ? id : null;
}
