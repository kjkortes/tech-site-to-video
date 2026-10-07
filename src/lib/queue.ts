import { Queue } from 'bullmq';
import { config } from './config';
let queue: Queue | undefined;
export function redisConnection() {
  const url = new URL(config.redis);
  return { host: url.hostname, port: Number(url.port || 6379), username: url.username || undefined, password: url.password || undefined, db: Number(url.pathname.slice(1) || 0), ...(url.protocol === 'rediss:' ? { tls: {} } : {}), maxRetriesPerRequest: null };
}
export async function enqueue(id: string, revision: number) {
  if (!config.redis) return;
  queue ||= new Queue('tech-demo-video', { connection: redisConnection() });
  await queue.add('generate', { id }, { jobId: `${id}-r${revision}`, attempts: 2, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: 100, removeOnFail: 100 });
}
