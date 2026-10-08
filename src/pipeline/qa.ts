import path from 'node:path';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { jobDir } from '../lib/store';
import { probe, run } from '../lib/process';
import { modelJson, modelEnabled } from '../lib/llm';
import { Inventory, QAReport, Research, Script, Shot, ShotResult, Transcript } from '../lib/types';
import { validateScript } from './script';
import { directedCaptions, validateCaptions } from './captions';
import { validateCoverage } from './coverage';
import { validateRetention } from './retention';
import { safeVisual } from './safe-area';
import { codeVisualsAllowed } from './content-policy';
import { focalIsSafe } from './framing';
import { cameraSummary, validateCameraPlan } from './camera-policy';

import { validatePlan, captionIntersectsFocus } from './direct';
import { validateContinuity } from './walkthrough';
import { shotSignature } from './record';
import { panelFor } from './video-layout';

export async function auditScript(script: Script, research: Research) {
  return modelJson('Independently audit each narration segment against its cited source quotes. Return {supported:boolean,issues:[string]}. Every factual assertion must be entailed by its cited quotes. Reject added claims about price, licenses, capabilities, benefits, purposes, or website locations. Evaluate the actual words asserted, not stronger statements the narration does not make. Lists introduced by "includes", "such as", or "examples" are non-exhaustive: naming three examples does not assert that there are exactly or only three in total. Conversely, "only", "exactly", and exhaustive totals require explicit evidence. Accept faithful paraphrases and literal counts of explicitly named items. Report specific unsupported assertions, not speculative implications or stylistic preferences.', { script, claims: research.claims }, z.object({ supported: z.boolean(), issues: z.array(z.string()) }),[], 'qa');
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
  add('target', 'Short video length', duration >= 20 && duration <= 65, `Concise story, typically 40–50 seconds; no required minute. Actual: ${duration.toFixed(1)} seconds.`, 'warning');
  add('resolution', 'Vertical 1080p', video?.width === 1080 && video?.height === 1920, `${video?.width} × ${video?.height}`);
  add('audio', 'Narration track', !!audio, audio ? `Audio encoded as ${audio.codec_name}` : 'No audio stream found');
  add('delivery', '30fps and AAC 48kHz delivery', video?.avg_frame_rate === '30/1' && audio?.codec_name === 'aac' && audio?.sample_rate === '48000', `${video?.avg_frame_rate}fps / ${audio?.codec_name} ${audio?.sample_rate}Hz`);
  const diversity = validatePlan(shots, inventory, transcript);
  const coverage=validateCoverage(shots,inventory,transcript,research),retention=validateRetention(shots,inventory,transcript,script);
  add('visual-coverage','Narration-supported visual coverage',coverage.passed,`${coverage.groups.length} explicit source/phrase groups. ${coverage.issues.map(i=>i.detail).join('; ')}`);
  add('readability','Cutaway inspection time',!coverage.issues.some(i=>i.code==='readability-time'||i.code==='short-payoff'),coverage.issues.filter(i=>i.severity==='warning').map(i=>i.detail).join('; ')||'Sources remain visible for full phrases and readable inspection time','warning');
  add('retention','Hook, progression and final payoff',retention.passed,`Retention ${retention.score}/100. ${retention.issues.map(i=>i.detail).join('; ')}`);
  add('retention-review','Story pacing review',!retention.issues.length,retention.issues.map(i=>i.detail).join('; ')||'Immediate product, complete source explanations and a readable final product payoff','warning');
  add('full-bleed-scale','Source fills the video viewport',shots.every(s=>safeVisual(panelFor(s.framing))),'Native page viewport spans the canvas; media preserves the full source using contain, with captions overlaid');
  const camera=validateCameraPlan(shots,inventory,transcript),summary=cameraSummary(shots,inventory);
  add('camera-policy','Source intro, contextual camera and temporary detail',camera.passed,camera.issues.map(i=>i.detail).join('; ')||`Page ${(summary.pageRatio*100).toFixed(1)}%, contextual ${(summary.contextualRatio*100).toFixed(1)}%, detail ${(summary.detailRatio*100).toFixed(1)}%; media starts wide`);
  add('visible-source-area','Source context remains visible',summary.views.every(v=>v.visibleSourceArea>=.5),`Minimum visible source area ${(Math.min(...summary.views.map(v=>v.visibleSourceArea))*100).toFixed(1)}%`);
  add('platform-zones','Critical features avoid platform UI',shots.every(s=>{const a=inventory.assets?.find(a=>a.id===s.assetId);return !a||focalIsSafe(s,a);}), 'Full-bleed source may extend beneath UI; the narrated focal area stays above captions and left of controls');
  add('promotional-code','Content mode visual policy',codeVisualsAllowed(inventory.contentMode)||!shots.some(s=>s.type==='code_focus'),'Promotional mode blocks raw code and generated command cards');
  const media=shots.filter(s=>s.type!=='diagram' && ['image','gif','video'].includes(inventory.assets?.find(a=>a.id===s.assetId)?.type||''));
  add('media-isolation','One intended asset per media cutaway',media.every(s=>{const r=recordings.find(r=>r.id===s.id);return !s.contextPreview && !r?.fallback && r?.mediaIsolation?.assetId===s.assetId && r?.mediaIsolation?.layers===1;}),'Media comes from a raw file or exact image element; no README origin overlays or gallery fallbacks');
  add('source-code','Actual source code is used when available',shots.filter(s=>s.type==='code_focus').every(s=>recordings.find(r=>r.id===s.id)?.kind==='asset'),'Original syntax-highlighted code captures take priority; generated excerpts are reported fallbacks','warning');
  const continuity=validateContinuity(shots,inventory,transcript);
  add('walkthrough','Document walkthrough continuity',continuity.passed,`Continuity ${continuity.score}/100; browser ${(100*continuity.browserDuration/transcript.duration).toFixed(0)}%. ${continuity.issues.map(i=>i.detail).join('; ')}`);
  add('visual-plan', 'Visual direction and diversity', diversity.passed, `Diversity ${diversity.score}/100; visible scroll ${diversity.scrollDuration.toFixed(1)}s. ${diversity.issues.map(i => i.detail).join('; ')}`);
  add('shot-signatures', 'Planned captures match selected visuals', shots.every(s => recordings.find(r=>r.id===s.id)?.signature === shotSignature(s)), 'Capture checkpoints match exact visual intent');
  add('consent', 'Content is unobscured', recordings.every(r => !r.consentObscured), 'Consent overlays rejected during clean browser capture');
  const signals = await run('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'blackdetect=d=0.35:pix_th=0.10', '-af', 'silencedetect=n=-45dB:d=2.5', '-f', 'null', '-']);
  add('black', 'No black frames', !/black_start:/.test(signals), /black_start:/.test(signals) ? 'Detected a black interval longer than 0.35 seconds' : 'No black intervals detected');
  const silenceStarts = [...signals.matchAll(/silence_start: ([\d.]+)/g)].map(m => Number(m[1]));
  add('silence', 'Continuous narration', !silenceStarts.some(t => t < duration - 2.5), silenceStarts.length ? `Detected sustained silence at ${silenceStarts.join(', ')}s` : 'No unexpected silent intervals');
  let freezeCount = 0;
  for (const recording of recordings) {
    const scan = await run('ffmpeg', ['-hide_banner', '-ss', String(recording.trimStart), '-t', String(recording.duration), '-i', path.join(jobDir(id), recording.clip), '-vf', 'freezedetect=n=-55dB:d=5.5', '-an', '-f', 'null', '-']);
    if (/freeze_start:/.test(scan) && (recordings.find(r=>r.id===recording.id)?.kind==='browser' && shots.find(s=>s.id===recording.id)?.walkthrough?.transition || shots.find(s=>s.id===recording.id)?.cameraMode==='detail')) freezeCount++;
    const clip = await probe(path.join(jobDir(id), recording.clip));
    add(`clip-${recording.id}`, `Shot ${Number(recording.id)} coverage`, Number(clip.format.duration) + 0.2 >= recording.trimStart + recording.duration, `Saved clip covers its ${recording.duration.toFixed(1)}s narration segment`);
  }
  add('freeze', 'Footage movement', freezeCount === 0, freezeCount ? `${freezeCount} shots contain static sections; they may be intentional page views` : 'No sustained freezes detected', 'warning');
  add('pages', 'No error pages', recordings.every(r => !/\b(404|403|page not found|access denied|just a moment)\b/i.test(r.pageTitle)), 'Checked recorded page titles');
  const captions = directedCaptions(transcript, shots);
  add('captions', 'Fixed lower safe captions', validateCaptions(captions) && captions.every(c=>c.start>=0 && c.end<=transcript.duration+.025) && shots.every(s=>s.captionPosition==='bottom-center'), 'Readable 42–48px captions, at most two lines, inside the lower safe band; right and bottom platform exclusions remain clear');
  const collisions=shots.filter(s=>captionIntersectsFocus(s,inventory.assets?.find(a=>a.id===s.assetId)));
  add('caption-focus', 'Captions avoid focal UI', !collisions.length, collisions.length ? `Reframe visuals in shots ${collisions.map(s=>s.id).join(', ')}` : 'Visual panels and source focal geometry remain above the fixed subtitle zone');
  let structural = true;
  try { validateScript(script, research, inventory); } catch { structural = false; }
  add('sources', 'Source-backed narration', structural && research.claims.every(c => research.sources.find(s => s.id === c.sourceId)?.text.includes(c.quote)), 'Every claim maps to an exact excerpt and every segment maps to a discovered scene');
  const total = shots.reduce((sum, shot) => sum + shot.duration, 0);
  add('coverage', 'Full visual coverage', Math.abs(total - transcript.duration) < 0.1 && shots.length === recordings.length && new Set(recordings.map(r=>r.id)).size === shots.length && shots.every(s=>recordings.some(r=>r.id===s.id)), 'Shot plan follows narration timing without gaps');
  add('fallbacks', 'Selected visuals captured successfully', recordings.every(r => !r.fallback), `${recordings.filter(r => r.fallback).length} screenshot fallbacks`, 'warning');
  if (modelEnabled() && script.mode === 'model' && (!script.review || script.review.source==='generated')) {
    const verdict = await auditScript(script, research);
    add('semantic', 'Claims match their evidence', verdict.supported, verdict.issues.join('; ') || 'Independent model audit passed');
  }
  if(script.review && script.review.source!=='generated')add('human-script','Human-authored narration',false,'The exact user-approved script is authoritative. Structural source associations are checked; factual wording requires human review.','warning');
  const diagrams = shots.filter(s => s.type === 'diagram').map(s => ({ shotId: s.id, diagram: s.diagram, narration: transcript.segments.find(b=>b.id===s.segmentId)?.text }));
  if (diagrams.length && modelEnabled()) {
    const verdict = await modelJson('Audit these diagrams against research quotes. Every directed edge must be explicitly entailed by its cited evidence. Reject guessed architecture, causal direction, or unsupported nodes. Return {supported,issues}.', { diagrams, claims: research.claims }, z.object({ supported: z.boolean(), issues: z.array(z.string()) }),[], 'qa');
    add('diagram-evidence', 'Diagram relationships are source-backed', verdict.supported, verdict.issues.join('; ') || 'Diagram audit passed');
  }
  add('vision', 'Frame meaning', false, 'Pixel-level semantic review is not configured. Review the final footage before approval.', 'warning');
  const passed = checks.every(c => c.passed || c.severity === 'warning');
  const score = Math.round(100 * checks.filter(c => c.passed).length / checks.length);
  return { score, passed, checks, checkedAt: new Date().toISOString() };
}
