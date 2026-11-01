import 'dotenv/config';
import { buildApp } from './app';
import { loadEnv } from './config/env';
import { buildDeps } from './deps';
import { createQueues, createRedis } from './queue';

async function main() {
  const env = loadEnv();
  const redis = createRedis(env.REDIS_URL);
  const queues = createQueues(redis);
  const app = buildApp(buildDeps(env), queues);

  const shutdown = async () => {
    await app.close();
    await queues.close();
    await redis.quit();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
