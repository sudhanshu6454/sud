/**
 * Meta Graph API client for comment replies (the Meta brief of 2026-09-30).
 *
 * - Graph API version META_GRAPH_VERSION (default v26.0).
 * - Every call carries appsecret_proof = HMAC-SHA256(access token, app
 *   secret) (the "Require App Secret" setting).
 * - Page tokens come from GET /me/accounts with the system user's token
 *   (META_SYSTEM_USER_TOKEN) and live in memory only — never stored, never
 *   logged; an Instagram account uses the token of the Page it is linked to.
 * - Private reply: POST /{IG account id | Page id}/messages with
 *   {"recipient":{"comment_id":…},"message":{"text":…}}.
 * - Public reply: Instagram POST /{comment id}/replies, Facebook POST
 *   /{comment id}/comments, with `message`.
 * - Errors are returned as Meta's (code, error_subcode) for
 *   @paparazzi/shared classifyMetaError; a response without a Graph error
 *   body is an unknown outcome (never resent). X-Business-Use-Case's
 *   estimated_time_to_regain_access (minutes) becomes retryAfterSeconds.
 */
import { createHmac } from 'node:crypto';

export const DEFAULT_GRAPH_VERSION = 'v26.0';
export const GRAPH_BASE = 'https://graph.facebook.com';

export interface GraphResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type GraphFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<GraphResponseLike>;

export interface GraphError {
  code: number | null;
  subcode: number | null;
  message: string;
  httpStatus: number | null;
}

export type GraphResult<T> = { ok: true; body: T } | { ok: false; error: GraphError | null; retryAfterSeconds: number | null };

export interface GraphConfig {
  appSecret: string;
  version?: string;
  base?: string;
  fetch?: GraphFetch;
  timeoutMs?: number;
}

export function appSecretProof(token: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(token).digest('hex');
}

/** Minutes → seconds from X-Business-Use-Case ({"<id>":[{"estimated_time_to_regain_access":N,…}]}). */
export function regainSeconds(header: string | null): number | null {
  if (!header) return null;
  try {
    const parsed = JSON.parse(header) as Record<string, Array<{ estimated_time_to_regain_access?: number }>>;
    let max = 0;
    for (const v of Object.values(parsed)) for (const e of v ?? []) max = Math.max(max, Number(e.estimated_time_to_regain_access ?? 0));
    return max > 0 ? max * 60 : null;
  } catch {
    return null;
  }
}

export class GraphClient {
  private readonly version: string;
  private readonly base: string;
  private readonly fetchImpl: GraphFetch;
  private readonly timeoutMs: number;
  constructor(private readonly cfg: GraphConfig) {
    this.version = cfg.version ?? DEFAULT_GRAPH_VERSION;
    this.base = cfg.base ?? GRAPH_BASE;
    this.fetchImpl = cfg.fetch ?? (globalThis.fetch as unknown as GraphFetch);
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
  }

  async call<T>(method: 'GET' | 'POST', path: string, token: string, body?: Record<string, unknown>, query: Record<string, string> = {}): Promise<GraphResult<T>> {
    const params = new URLSearchParams({ ...query, appsecret_proof: appSecretProof(token, this.cfg.appSecret) });
    const url = `${this.base}/${this.version}${path}?${params.toString()}`;
    let res: GraphResponseLike;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // No answer: the request may or may not have reached Meta.
      return { ok: false, error: null, retryAfterSeconds: null };
    }
    const text = await res.text().catch(() => '');
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    const retryAfterSeconds = regainSeconds(res.headers.get('x-business-use-case-usage') ?? res.headers.get('x-business-use-case'));
    if (res.status >= 200 && res.status < 300 && parsed && typeof parsed === 'object' && !('error' in (parsed as object))) {
      return { ok: true, body: parsed as T };
    }
    const e = parsed && typeof parsed === 'object' ? (parsed as { error?: { code?: unknown; error_subcode?: unknown; message?: unknown } }).error : undefined;
    if (!e) return { ok: false, error: null, retryAfterSeconds };
    return {
      ok: false,
      error: {
        code: typeof e.code === 'number' ? e.code : null,
        subcode: typeof e.error_subcode === 'number' ? e.error_subcode : null,
        message: typeof e.message === 'string' ? e.message.slice(0, 200) : 'Graph error',
        httpStatus: res.status,
      },
      retryAfterSeconds,
    };
  }
}

export interface PageAccount {
  pageId: string;
  pageName: string | null;
  pageUsername: string | null;
  tasks: string[];
  instagramId: string | null;
  instagramUsername: string | null;
}

/**
 * Page tokens from the system user's token (GET /me/accounts, paginated),
 * in memory only, refreshed after `ttlMs` (default 1 h) and after any
 * invalid-token error (`invalidate`).
 */
export class PageTokenStore {
  private tokens = new Map<string, string>();
  private accounts: PageAccount[] = [];
  private loadedAt = 0;
  constructor(
    private readonly graph: GraphClient,
    private readonly systemUserToken: string,
    private readonly ttlMs = 3_600_000,
    private readonly now: () => number = Date.now,
  ) {}

  invalidate(): void {
    this.loadedAt = 0;
  }

  async load(): Promise<PageAccount[]> {
    if (this.loadedAt && this.now() - this.loadedAt < this.ttlMs) return this.accounts;
    const tokens = new Map<string, string>();
    const accounts: PageAccount[] = [];
    let after: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const query: Record<string, string> = {
        fields: 'id,name,username,access_token,tasks,instagram_business_account{id,username}',
        limit: '100',
        ...(after ? { after } : {}),
      };
      const res = await this.graph.call<{
        data?: Array<{ id: string; name?: string; username?: string; access_token?: string; tasks?: string[]; instagram_business_account?: { id?: string; username?: string } }>;
        paging?: { cursors?: { after?: string }; next?: string };
      }>('GET', '/me/accounts', this.systemUserToken, undefined, query);
      if (!res.ok) throw new Error(`GET /me/accounts failed: ${res.error ? `${res.error.code}/${res.error.subcode ?? ''}` : 'no answer'}`);
      for (const p of res.body.data ?? []) {
        if (!p.id || !p.access_token) continue;
        tokens.set(p.id, p.access_token);
        const ig = p.instagram_business_account;
        if (ig?.id) tokens.set(ig.id, p.access_token);
        accounts.push({
          pageId: p.id,
          pageName: p.name ?? null,
          pageUsername: p.username ?? null,
          tasks: p.tasks ?? [],
          instagramId: ig?.id ?? null,
          instagramUsername: ig?.username ?? null,
        });
      }
      after = res.body.paging?.next ? res.body.paging.cursors?.after ?? null : null;
      if (!after) break;
    }
    this.tokens = tokens;
    this.accounts = accounts;
    this.loadedAt = this.now();
    return accounts;
  }

  /** The Page token for a Page id or a linked Instagram account id. */
  async tokenFor(accountId: string): Promise<string | null> {
    await this.load();
    return this.tokens.get(accountId) ?? null;
  }
}
