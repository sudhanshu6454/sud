/**
 * Comment-reply settings from the environment (the workers service):
 *   COMMENT_REPLIES_SENDING   off (default) | shadow | on
 *   SITE_URL                  the only origin a message links to (default https://afflino.com)
 *   META_APP_SECRET           secret: appsecret_proof on every Graph call
 *   META_SYSTEM_USER_TOKEN    secret: the system user's token (Page tokens are derived from it, in memory)
 *   META_GRAPH_VERSION        default v26.0
 *   COMMENT_REPLIES_SWEEP_MS  how often ready events are enqueued (default 5000)
 * 'on' without both secrets falls back to 'off' (logged once): nothing is
 * sent without credentials, and nothing pretends to be sent.
 */
import { parseSendingMode, type ReplySendingMode } from '@paparazzi/shared';
import { DEFAULT_GRAPH_VERSION, GraphClient, PageTokenStore } from '../meta/graph';
import { GraphReplySender, StubReplySender, type ReplyDeps } from './sender';

export interface ReplyConfig {
  mode: ReplySendingMode;
  siteOrigin: string;
  sweepMs: number;
  reason: string | null;
}

export function replyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ReplyConfig {
  let mode = parseSendingMode(env.COMMENT_REPLIES_SENDING);
  let reason: string | null = null;
  if (mode === 'on' && (!env.META_APP_SECRET?.trim() || !env.META_SYSTEM_USER_TOKEN?.trim())) {
    mode = 'off';
    reason = 'COMMENT_REPLIES_SENDING=on without META_APP_SECRET and META_SYSTEM_USER_TOKEN: nothing is sent';
  }
  const sweep = Number(env.COMMENT_REPLIES_SWEEP_MS);
  return {
    mode,
    siteOrigin: (env.SITE_URL?.trim() || 'https://afflino.com').replace(/\/$/, ''),
    sweepMs: Number.isInteger(sweep) && sweep >= 1000 ? sweep : 5000,
    reason,
  };
}

/** The deps processReplyEvent runs with: the Graph sender when 'on', a sender that never sends otherwise. */
export function replyDepsFromEnv(env: NodeJS.ProcessEnv = process.env, log?: ReplyDeps['log']): ReplyDeps {
  const cfg = replyConfigFromEnv(env);
  if (cfg.mode !== 'on') {
    return {
      mode: cfg.mode,
      siteOrigin: cfg.siteOrigin,
      // Never called in off / shadow (processReplyEvent returns before the send).
      sender: new StubReplySender(() => ({ ok: false, error: null, retryAfterSeconds: null })),
      ...(log ? { log } : {}),
    };
  }
  const graph = new GraphClient({ appSecret: (env.META_APP_SECRET as string).trim(), version: env.META_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION });
  const tokens = new PageTokenStore(graph, (env.META_SYSTEM_USER_TOKEN as string).trim());
  return { mode: 'on', siteOrigin: cfg.siteOrigin, sender: new GraphReplySender(graph, tokens), ...(log ? { log } : {}) };
}
