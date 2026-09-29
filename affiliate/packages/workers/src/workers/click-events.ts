/**
 * click-events worker.
 *
 * Consumes click observation events dispatched by the redirect service.
 * Responsibilities here are intentionally thin: validate the event envelope
 * (integrity check, not authentication) and record the observation. Click
 * aggregation into analytics cohorts is a TODO — and analytics must never
 * modify money (the ledger is the source of balances).
 */

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { hashPayload, type EventEnvelope } from '@paparazzi/shared';
import { QUEUE_CLICK_EVENTS, createRedisConnection } from '../queues';
import { createLogger } from '../logging';

const log = createLogger('worker:click-events');

export interface ClickEventsJobData {
  envelope: EventEnvelope;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function processClickEvent(job: Job<ClickEventsJobData>): Promise<void> {
  const { envelope } = job.data;

  // Integrity check: the payload must not have been tampered with in transit.
  if (hashPayload(envelope.payload) !== envelope.payload_hash) {
    log('error', 'envelope payload_hash mismatch; dropping job', {
      jobId: job.id,
      event_id: envelope.event_id,
    });
    // TODO: dead-letter queue with replay controls (brief §10: exhausted jobs
    // go to a DLQ; a hash mismatch is poison and must not be retried blindly).
    return;
  }

  const payload = envelope.payload;
  const clickId =
    isRecord(payload) && typeof payload.click_id === 'string' ? payload.click_id : 'unknown';

  log('info', 'click.observed', {
    jobId: job.id,
    event_id: envelope.event_id,
    click_id: clickId,
  });

  // TODO: aggregate into analytics (click cohorts, EPC inputs per brief §12).
  // The analytics pipeline is read-only with respect to money.
}

/** Start a Worker on the click-events queue. The caller owns the connection lifecycle. */
export function createClickEventsWorker(connection?: Redis): Worker<ClickEventsJobData> {
  const worker = new Worker<ClickEventsJobData>(QUEUE_CLICK_EVENTS, processClickEvent, {
    connection: connection ?? createRedisConnection(),
  });
  worker.on('failed', (job, error) => {
    log('error', 'job failed', { jobId: job?.id, error: error.message });
  });
  return worker;
}
