import path from 'node:path';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { jobDir } from '../lib/store';
import { probe, run } from '../lib/process';
import { modelJson, modelEnabled } from '../lib/llm';
import { Inventory, QAReport, Research, Script, Shot, ShotResult, Transcript } from '../lib/types';
import { validateScript } from './script';
import { captionChunks } from './captions';

export async function auditScript(script: Script, research: Research) {
  return modelJson('Independently audit each narration segment against its cited source quotes. Return {supported:boolean,issues:[string]}. Every factual assertion must be entailed by its cited quotes. Reject added claims about price, licenses, capabilities, benefits, purposes, or website locations. Evaluate the actual words asserted, not stronger statements the narration does not make. Lists introduced by "includes", "such as", or "examples" are non-exhaustive: naming three examples does not assert that there are exactly or only three in total. Conversely, "only", "exactly", and exhaustive totals require explicit evidence. Accept faithful paraphrases and literal counts of explicitly named items. Report specific unsupported assertions, not speculative implications or stylistic preferences.', { script, claims: research.claims }, z.object({ supported: z.boolean(), issues: z.array(z.string()) }));
}

export async function checkVideo(id: string, research: Research, inventory: Inventory, script: Script, transcript: Transcript, shots: Shot[], recordings: ShotResult[]): Promise<QAReport> {
  const checks: QAReport['checks'] = [];
  const add = (id: string, label: string, passed: boolean, detail: string, severity: 'error' | 'warning' = 'error') => checks.push({ id, label, passed, detail, severity });
  const file = path.join(jobDir(id), 'final.mp4');
  const exists = await stat(file).then(s => s.size > 10000).catch(() => false);
  add('file', 'Playable MP4', exists, exists ? 'Rendered file exists and is non-empty' : 'MP4 is missing or empty');
  if (!exists) return { score: 0, passed: false, checks, checkedAt: new Date().toISOString() };
  const info = await probe(file); const duration = Number(info.format.duration);
  const video = info.streams.find(s => s.codec_type === 'video'); const audio = info.streams.find(s => s.codec_type === 'audio');
  add('duration', 'Voice and picture timing', Math.abs(duration - transcript.duration) < 0.35, `${duration.toFixed(2)}s video / ${transcript.duration.toFixed(2)}s narration`);
  add('target', 'Short video length', duration >= 40 && duration <= 75, `Target: about 60 seconds. Actual: ${duration.toFixed(1)} seconds.`, 'warning');
  add('resolution', 'Vertical 1080p', video?.width === 1080 && video?.height === 1920, `${video?.width} × ${video?.height}`);
  add('audio', 'Narration track', !!audio, audio ? `Audio encoded as ${audio.codec_name}` : 'No audio stream found');
  const signals = await run('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'blackdetect=d=0.35:pix_th=0.10', '-af', 'silencedetect=n=-45dB:d=2.5', '-f', 'null', '-']);
  add('black', 'No black frames', !/black_start:/.test(signals), /black_start:/.test(signals) ? 'Detected a black interval longer than 0.35 seconds' : 'No black intervals detected');
  const silenceStarts = [...signals.matchAll(/silence_start: ([\d.]+)/g)].map(m => Number(m[1]));
  add('silence', 'Continuous narration', !silenceStarts.some(t => t < duration - 2.5), silenceStarts.length ? `Detected sustained silence at ${silenceStarts.join(', ')}s` : 'No unexpected silent intervals');
  let freezeCount = 0;
  for (const recording of recordings) {
    const scan = await run('ffmpeg', ['-hide_banner', '-ss', String(recording.trimStart), '-t', String(recording.duration), '-i', path.join(jobDir(id), recording.clip), '-vf', 'freezedetect=n=-55dB:d=3', '-an', '-f', 'null', '-']);
    if (/freeze_start:/.test(scan)) freezeCount++;
    const clip = await probe(path.join(jobDir(id), recording.clip));
    add(`clip-${recording.id}`, `Shot ${Number(recording.id)} coverage`, Number(clip.format.duration) + 0.2 >= recording.trimStart + recording.duration, `Saved clip covers its ${recording.duration.toFixed(1)}s narration segment`);
  }
  add('freeze', 'Footage movement', freezeCount === 0, freezeCount ? `${freezeCount} shots contain static sections; they may be intentional page views` : 'No sustained freezes detected', 'warning');
  add('pages', 'No error pages', recordings.every(r => !/\b(404|403|page not found|access denied|just a moment)\b/i.test(r.pageTitle)), 'Checked recorded page titles');
  const captions = captionChunks(transcript);
  add('captions', 'Captions inside safe area', captions.every(c => c.text.length <= 60 && c.start >= 0 && c.end <= transcript.duration + 0.25), 'Captions are constrained to two lines inside the vertical frame');
  let structural = true;
  try { validateScript(script, research, inventory); } catch { structural = false; }
  add('sources', 'Source-backed narration', structural && research.claims.every(c => research.sources.find(s => s.id === c.sourceId)?.text.includes(c.quote)), 'Every claim maps to an exact excerpt and every segment maps to a discovered scene');
  const total = shots.reduce((sum, shot) => sum + shot.duration, 0);
  add('coverage', 'Full visual coverage', Math.abs(total - transcript.duration) < 0.1 && shots.length === recordings.length, 'Shot plan follows narration timing without gaps');
  add('fallbacks', 'Clean browser recordings', recordings.every(r => !r.fallback), `${recordings.filter(r => r.fallback).length} screenshot fallbacks`, 'warning');
  if (modelEnabled() && script.mode === 'model') {
    const verdict = await auditScript(script, research);
    add('semantic', 'Claims match their evidence', verdict.supported, verdict.issues.join('; ') || 'Independent model audit passed');
  }
  add('vision', 'Frame meaning', false, 'Pixel-level semantic review is not configured. Review the final footage before approval.', 'warning');
  const passed = checks.every(c => c.passed || c.severity === 'warning');
  const score = Math.round(100 * checks.filter(c => c.passed).length / checks.length);
  return { score, passed, checks, checkedAt: new Date().toISOString() };
}
