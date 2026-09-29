/**
 * Tracked-link URL composition, shared by POST /v1/links (mint) and the
 * catalogue detail endpoint GET /v1/looks/:id (read-back of an existing
 * link). Both must produce byte-identical URLs for the same token, so the
 * composition lives in exactly one place.
 *
 * REDIRECT_BASE_URL is the public origin of the redirect service
 * (packages/redirect, `GET /r/{token}`); a trailing slash is tolerated.
 */
export function redirectBaseUrl(): string {
  return (process.env.REDIRECT_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
}

/** `${REDIRECT_BASE_URL}/r/${token}` — the only URL a consumer ever sees. */
export function redirectLinkUrl(token: string): string {
  return `${redirectBaseUrl()}/r/${token}`;
}
