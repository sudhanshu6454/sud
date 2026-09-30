/**
 * What the api's and the redirect's request logs record about a request:
 * method, the path WITHOUT its query string, and hostname. The query is
 * never logged: it can carry a secret (Meta's webhook verification sends
 * hub.verify_token in it) or a visitor's input. Passed as the pino `req` serializer
 * (`Fastify({ logger: { serializers: { req: requestLogFields } } })`).
 *
 * Deliberately NOT Fastify's default, which adds `remoteAddress` (= `req.ip`)
 * and `remotePort`: with TRUST_PROXY set (docker-compose.prod.yml sets
 * `loopback,uniquelocal` behind the edge), `req.ip` is the visitor's real
 * address, and the stack keeps no client address in the clear by default —
 * the redirect stores only a keyed hash of it, the edge writes no access log.
 * Whether any log may carry client addresses (and for how long) is a counsel
 * question (docs/threat-model.md), not a default.
 */
export interface RequestLogFields {
  /** pino's serializer result type is an open record. */
  [key: string]: unknown;
  method?: string;
  url?: string;
  hostname?: string;
}

export function requestLogFields(req: { method?: string; url?: string; hostname?: string }): RequestLogFields {
  const url = typeof req.url === 'string' ? (req.url.split('?')[0] as string) : req.url;
  return { method: req.method, url, hostname: req.hostname };
}
