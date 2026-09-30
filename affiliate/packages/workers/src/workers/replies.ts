/**
 * comment-replies worker (0007): a repeatable 'sweep' job (every
 * COMMENT_REPLIES_SWEEP_MS, default 5 s) expires events past Meta's 7-day
 * window and enqueues one 'send' job per ready event (job id
 * reply-<event>-<attempt>, so a sweep that sees the same event twice adds it
 * once); 'send' runs processReplyEvent (src/replies/sender.ts), whose
 * conditional claim makes a duplicate job a no-op. Nothing is sent while
 * COMMENT_REPLIES_SENDING is off (the default).
 */
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { QUEUE_COMMENT_REPLIES, commentRepliesQueue, createRedisConnection } from '../queues';
import { createLogger, errorMessage } from '../logging';
import { processReplyEvent, sweepReplyEvents, type ReplyDeps } from '../replies/sender';
import { replyConfigFromEnv, replyDepsFromEnv } from '../replies/config';

const log = createLogger('worker:comment-replies');

export interface CommentReplyJobData {
  event_id?: string;
}

export function createCommentRepliesProcessor(pool: Pool, deps: ReplyDeps) {
  return async function processCommentReplyJob(job: Job<CommentReplyJobData>): Promise<void> {
    if (job.name === 'sweep') {
      const { expired, ready } = await sweepReplyEvents(pool);
      if (expired > 0) log('info', 'reply events expired (past the 7-day window)', { expired });
      if (deps.mode === 'off') return;
      for (const r of ready) {
        await commentRepliesQueue.add('send', { event_id: r.id }, { jobId: `reply-${r.id}-${r.attempts}`, removeOnComplete: 1000, removeOnFail: 5000 });
      }
      return;
    }
    if (job.name === 'send' && job.data.event_id) {
      const outcome = await processReplyEvent(pool, job.data.event_id, deps);
      log('info', 'reply event processed', { event_id: job.data.event_id, outcome });
    }
  };
}

export function createCommentRepliesWorker(pool: Pool, connection?: Redis): Worker<CommentReplyJobData> {
  const deps = replyDepsFromEnv(process.env, (level, message, fields) => log(level, message, fields));
  const cfg = replyConfigFromEnv();
  if (cfg.reason) log('error', cfg.reason);
  log('info', 'comment replies', { mode: deps.mode, site_origin: deps.siteOrigin });
  const worker = new Worker<CommentReplyJobData>(QUEUE_COMMENT_REPLIES, createCommentRepliesProcessor(pool, deps), {
    connection: connection ?? createRedisConnection(),
    concurrency: 4,
  });
  worker.on('failed', (job, error) => {
    log('error', 'job failed', { jobId: job?.id, error: errorMessage(error) });
  });
  return worker;
}

export async function scheduleCommentRepliesRepeat(): Promise<void> {
  const cfg = replyConfigFromEnv();
  await commentRepliesQueue.add('sweep', {}, { repeat: { every: cfg.sweepMs }, removeOnComplete: 100, removeOnFail: 100 });
  log('info', 'comment-replies sweep scheduled', { every_ms: cfg.sweepMs, queue: QUEUE_COMMENT_REPLIES });
}
