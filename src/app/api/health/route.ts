import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '@/lib/config';
export const runtime = 'nodejs';
export async function GET() {
  const worker = await readFile(path.join(config.dataDir, 'worker.json'), 'utf8').then(JSON.parse).catch(() => null);
  const workerReady = worker && Date.now() - new Date(worker.at).getTime() < 20000;
  const tts = await fetch(`${config.ttsBase}/api/status`, { signal: AbortSignal.timeout(2500) }).then(async r => r.ok ? await r.json() : null).catch(() => null);
  return NextResponse.json({ worker: !!workerReady, tts: !!tts && tts.state !== 'error', ttsState: tts?.state || 'offline', model: config.llmKey ? 'AI research' : 'Source excerpts', renderer: config.renderer, storage: config.database ? 'PostgreSQL' : 'Local', queue: config.redis ? 'BullMQ' : 'Local' });
}
