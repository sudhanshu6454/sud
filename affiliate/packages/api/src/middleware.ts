import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { AppError } from '@paparazzi/shared';

export interface Tenant {
  sub: string;
  org_id: string;
  role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Unique per-request id, also returned as the `X-Request-Id` header. */
    requestId: string;
    /** Authenticated tenant (set by requireAuth). */
    tenant?: Tenant;
    /** Present when the request carried an Idempotency-Key header. */
    idempotencyKey?: string;
  }
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  return secret;
}

/**
 * Global onRequest hook: assigns a request id and exposes it to the client.
 * All success/error envelopes include this id for traceability.
 */
export async function requestIdHook(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const requestId = randomUUID();
    req.requestId = requestId;
    reply.header('X-Request-Id', requestId);
  });
}

/**
 * Verifies the Bearer JWT and attaches `request.tenant`.
 * Expected claims: { sub, org_id, role }.
 * TODO: validate (sub, org_id, role) against the memberships table instead of
 * trusting the token alone; add expiry/issuer/audience checks centrally.
 */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError('UNAUTHORIZED', 'Missing or malformed Authorization header', 401);
  }
  let decoded: unknown;
  try {
    decoded = jwt.verify(header.slice('Bearer '.length), jwtSecret());
  } catch {
    throw new AppError('UNAUTHORIZED', 'Invalid or expired token', 401);
  }
  const claims = decoded as { sub?: unknown; org_id?: unknown; role?: unknown };
  if (typeof claims.sub !== 'string' || typeof claims.org_id !== 'string' || typeof claims.role !== 'string') {
    throw new AppError('UNAUTHORIZED', 'Token is missing required claims (sub, org_id, role)', 401);
  }
  req.tenant = { sub: claims.sub, org_id: claims.org_id, role: claims.role };
}

function tenantOf(req: FastifyRequest): Tenant {
  if (!req.tenant) throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
  return req.tenant;
}

/**
 * Minimal role matrix (TODO: replace with full RBAC backed by memberships).
 * Usage: preHandler: [requireAuth, requireRole('network_admin', 'finance_approver')]
 */
export function requireRole(...roles: string[]) {
  return async function roleGuard(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const tenant = tenantOf(req);
    if (!roles.includes(tenant.role)) {
      throw new AppError('FORBIDDEN', `Role '${tenant.role}' is not allowed for this operation`, 403);
    }
  };
}

/** Convenience for handlers: tenant is guaranteed present after requireAuth. */
export function authed(req: FastifyRequest): Tenant {
  return tenantOf(req);
}
