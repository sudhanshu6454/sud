import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, apiError } from '@paparazzi/shared';

/**
 * Central error mapping:
 * - AppError        → its own status + code
 * - Fastify 404     → NOT_FOUND (handled by setNotFoundHandler below)
 * - Validation      → VALIDATION_ERROR 400 (thrown explicitly at route level)
 * - Fastify's own client errors (FST_ERR_* with a 4xx statusCode: an empty
 *   or malformed JSON body, an unsupported content type, a body over the
 *   limit) → VALIDATION_ERROR with that 4xx status; they describe the
 *   request, never server state
 * - Anything else   → INTERNAL 500 (logged, message not leaked)
 *
 * Every error response carries the request_id so clients can correlate
 * with server logs.
 */
export async function registerErrorHandling(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err: Error, req: FastifyRequest, reply: FastifyReply) => {
    const request_id = req.requestId ?? 'unknown';

    if (err instanceof AppError) {
      return reply.status(err.status).send(apiError(err.code, err.message, request_id));
    }

    // Fastify request-validation errors (e.g. malformed JSON body)
    const withStatus = err as Error & { statusCode?: number; validation?: unknown; code?: unknown };
    if (withStatus.statusCode === 400 && withStatus.validation) {
      return reply.status(400).send(apiError('VALIDATION_ERROR', 'Request failed validation', request_id));
    }

    // Fastify's own request errors (content-type parser, body limit, …):
    // a client error, not an INTERNAL. The message names the request
    // problem ("Body cannot be empty when content-type is set to
    // 'application/json'") and carries no server state.
    const status = withStatus.statusCode;
    if (
      typeof withStatus.code === 'string' &&
      withStatus.code.startsWith('FST_ERR_') &&
      typeof status === 'number' &&
      status >= 400 &&
      status < 500
    ) {
      return reply.status(status).send(apiError('VALIDATION_ERROR', err.message, request_id));
    }

    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send(apiError('INTERNAL', 'Unexpected error', request_id));
  });

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    const request_id = req.requestId ?? 'unknown';
    return reply.status(404).send(apiError('NOT_FOUND', `No route for ${req.method} ${req.url}`, request_id));
  });
}
