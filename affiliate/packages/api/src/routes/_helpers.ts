import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '@paparazzi/shared';

/** Standard success envelope: { data, request_id }. */
export function ok<T>(req: FastifyRequest, data: T): { data: T; request_id: string } {
  return { data, request_id: req.requestId };
}

/** Parse with zod; on failure throw a 400 VALIDATION_ERROR AppError. */
export function parseOr400<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new AppError('VALIDATION_ERROR', `Invalid request: ${detail}`, 400);
  }
  return result.data;
}

/** bigint (pg → string) → number for JSON output. */
export function minorToNumber(value: string | number | null): number | null {
  if (value === null) return null;
  return Number(value);
}
