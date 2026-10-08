import { Worker } from 'bullmq';
import { config } from './lib/config';
import { listJobs } from './lib/store';
import { redisConnection, enqueue } from './lib/queue';
import { runnable } from './lib/workflow';
import { runPipeline } from './pipeline';
import { sleep } from './lib/process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

let stopping = false;
process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
await mkdir(config.dataDir, { recursive: true });
async function heartbeat() { await writeFile(path.join(config.dataDir, 'worker.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); }
await heartbeat(); const timer = setInterval(() => { void heartbeat().catch(console.error); }, 5000);
console.log(`Video worker started (${config.redis ? 'BullMQ' : 'local durable polling'}, ${config.renderer} renderer)`);
try {
  if (config.redis) {
    const worker = new Worker('tech-demo-video', async task => {
      const result = await runPipeline(task.data.id);
      if (result?.status === 'FAILED') console.error(`${result.id}: ${result.error}`);
    }, { connection: redisConnection(), concurrency: 1, lockDuration: 120000 });
    worker.on('error', console.error);
    // Recover jobs saved just before an API crash prevented queue insertion.
    while (!stopping) {
      for (const job of await listJobs()) if (runnable(job)) await enqueue(job.id, job.revision);
      await sleep(5000);
    }
    await worker.close();
  } else {
    while (!stopping) {
      const jobs = (await listJobs()).reverse().filter(job => runnable(job));
      for (const job of jobs) { if (stopping) break; console.log(`Processing ${job.id}: ${job.url}`); await runPipeline(job.id); }
      await sleep(2000);
    }
  }
} catch (error) { console.error(error); process.exitCode = 1; }
finally { clearInterval(timer); }
