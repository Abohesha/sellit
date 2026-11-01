import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';

export const QUEUE_NAMES = { draft: 'ai-draft', publish: 'ebay-publish' } as const;

export interface DraftJobData {
  userId: string;
  itemId: string;
  marketplaceId: string;
}

export interface PublishJobData {
  userId: string;
  itemId: string;
  marketplaceId: string;
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export function createRedis(url: string): Redis {
  // BullMQ requires this for blocking connections used by workers.
  return new Redis(url, { maxRetriesPerRequest: null });
}

export interface Queues {
  draft: Queue<DraftJobData>;
  publish: Queue<PublishJobData>;
  close(): Promise<void>;
}

export function createQueues(connection: ConnectionOptions): Queues {
  const draft = new Queue<DraftJobData>(QUEUE_NAMES.draft, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  const publish = new Queue<PublishJobData>(QUEUE_NAMES.publish, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  return {
    draft,
    publish,
    close: async () => {
      await Promise.all([draft.close(), publish.close()]);
    },
  };
}

export const draftJobId = (requestId: string) => `draft_${requestId}`;
/** One publish job per item and marketplace. The eBay SKU makes the work itself idempotent too. */
export const publishJobId = (itemId: string, marketplaceId: string) => `publish_${itemId}_${marketplaceId}`;
