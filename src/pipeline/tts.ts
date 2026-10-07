import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { config } from '../lib/config';
import { readArtifact, writeArtifact, jobDir } from '../lib/store';
import { Script, Transcript } from '../lib/types';
import { probe, sleep } from '../lib/process';

const responseSchema = z.object({ id: z.string(), state: z.string(), error: z.object({ message: z.string().optional() }).passthrough().nullable().optional(), audio_url: z.string().nullable().optional(), timing_source: z.string().nullable().optional(),
  segments: z.array(z.object({ text: z.string(), start: z.number().min(0), end: z.number().min(0) })).default([]),
  words: z.array(z.object({ text: z.string(), start: z.number().min(0), end: z.number().min(0) })).default([]) });
export async function generateSpeech(id: string, script: Script): Promise<Transcript> {
  const segments = script.segments.map(s => s.text);
  let progress = await readArtifact<{ ttsId: string }>(id, 'tts-progress.json').catch(() => null);
  async function start() {
    let response: Response;
    try {
      response = await fetch(`${config.ttsBase}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ engine: 'kokoro', text: segments.join('\n\n'), segments, language: 'a', primary_voice: config.ttsVoice, preset: 'neutral', output_format: 'wav', normalize: true, pause_ms: 180 }) });
    } catch { throw new Error(`Kokoro is unavailable at ${config.ttsBase}. Start kokoro-local-tts, then resume this project.`); }
    if (!response.ok) throw new Error(`Kokoro rejected narration (HTTP ${response.status}). Check TTS_VOICE and service settings.`);
    const job = responseSchema.parse(await response.json());
    progress = { ttsId: job.id }; await writeArtifact(id, 'tts-progress.json', progress);
  }
  if (!progress) await start();
  const deadline = Date.now() + config.ttsTimeout;
  while (Date.now() < deadline) {
    const response = await fetch(`${config.ttsBase}/api/jobs/${encodeURIComponent(progress!.ttsId)}`, { signal: AbortSignal.timeout(15000) });
    if (response.status === 404) { await start(); continue; }
    if (!response.ok) throw new Error(`Kokoro status returned HTTP ${response.status}`);
    const result = responseSchema.parse(await response.json());
    if (['failed', 'cancelled'].includes(result.state)) throw new Error(`Narration failed: ${result.error?.message || result.state}`);
    if (result.state !== 'complete') { await sleep(1500); continue; }
    if (!result.audio_url) throw new Error('Kokoro returned no audio file');
    const audioUrl = new URL(result.audio_url, config.ttsBase);
    if (audioUrl.origin !== new URL(config.ttsBase).origin) throw new Error('Kokoro audio must come from the configured local service');
    const audio = await fetch(audioUrl, { signal: AbortSignal.timeout(60000) });
    if (!audio.ok) throw new Error('Could not download narration');
    const file = path.join(jobDir(id), 'narration.wav');
    await writeFile(file, Buffer.from(await audio.arrayBuffer()));
    const info = await probe(file); const duration = Number(info.format.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Narration has no measurable duration');
    if (result.segments.length !== script.segments.length) throw new Error('Kokoro must return storyboard segment timestamps. Update your local TTS service and regenerate voice.');
    const timed = script.segments.map((s, i) => ({ ...s, start: result.segments[i].start, end: result.segments[i].end }));
    for (let i = 0; i < timed.length; i++) {
      if (timed[i].end <= timed[i].start || timed[i].end > duration + 0.25 || (i > 0 && timed[i].start < timed[i - 1].end - 0.05)) throw new Error('Kokoro returned invalid or overlapping speech timestamps');
    }
    return { duration, segments: timed, words: result.words, timingSource: result.timing_source || 'kokoro' };
  }
  throw new Error('Kokoro generation timed out. The speech job is saved; resume to poll it again.');
}
