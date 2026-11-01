import 'dotenv/config';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { loadEnv } from './config/env';
import { buildDeps, type Deps } from './deps';
import { QUEUE_NAMES, createRedis, type DraftJobData, type PublishJobData } from './queue';
import { NonRetryableError, describeError } from './jobs/errors';
import { processDraftJob } from './jobs/draftJob';
import { processPublishJob } from './jobs/publishJob';

/** Tracks status in the jobs table and turns non-retryable errors into BullMQ's UnrecoverableError. */
function tracked<T extends { userId: string; itemId: string }>(
  deps: Deps,
  type: string,
  run: (data: T, log: (m: string) => void) => Promise<void>,
) {
  return async (job: Job<T>) => {
    const base = { id: String(job.id), userId: job.data.userId, itemId: job.data.itemId, type };
    await deps.repo.upsertJob({ ...base, status: 'running' });
    try {
      await run(job.data, (m) => void job.log(m));
      await deps.repo.upsertJob({ ...base, status: 'succeeded' });
    } catch (err) {
      const message = describeError(err);
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const fatal = err instanceof NonRetryableError;
      await deps.repo.upsertJob({ ...base, status: fatal || finalAttempt ? 'failed' : 'queued', error: message });
      throw fatal ? new UnrecoverableError(message) : err;
    }
  };
}

async function main() {
  const env = loadEnv();
  const deps = buildDeps(env);
  const connection = createRedis(env.REDIS_URL);

  const workers = [
    new Worker<DraftJobData>(QUEUE_NAMES.draft, tracked(deps, 'draft', (d, l) => processDraftJob(deps, d, l)), {
      connection,
      concurrency: 4,
    }),
    // Low concurrency: eBay rate limits are shared by every user of the app.
    new Worker<PublishJobData>(QUEUE_NAMES.publish, tracked(deps, 'publish', (d, l) => processPublishJob(deps, d, l)), {
      connection,
      concurrency: 2,
    }),
  ];

  for (const w of workers) {
    w.on('failed', (job, err) => console.error(`[${w.name}] job ${job?.id} failed: ${describeError(err)}`));
  }
  console.log('workers started');

  const shutdown = async () => {
    await Promise.all(workers.map((w) => w.close()));
    await connection.quit();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
