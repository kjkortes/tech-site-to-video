import path from 'node:path';
import { jobDir } from '../lib/store';
import { run } from '../lib/process';
import { panelFor } from './video-layout';
import { captionAnchor } from './captions';
import { z } from 'zod';
import { Inventory, Shot, Transcript, Research, VisualAsset, FocusRegion, shotTypes, DiversityReport } from '../lib/types';
import { modelEnabled, modelJson } from '../lib/llm';

export const directorRevision = 1;
const center: FocusRegion = { x: .12, y: .12, width: .76, height: .76 };
const words = (text: string) => new Set(text.toLowerCase().split(/\W+/).filter(w => w.length > 3));
export function relevance(text: string, description: string) {
  const tokens = words(text); return [...words(description)].filter(w => tokens.has(w)).length;
}
export function assetsFor(inventory: Inventory): VisualAsset[] {
  return [...(inventory.assets || []), ...inventory.scenes.map(s => ({ id: s.id, sceneId: s.id, sourceId: s.sourceId, type: 'section' as const, url: s.url, pageUrl: s.url, localPath: s.screenshot, description: `${s.title} ${s.description}`, features: [s.title], width: inventory.captureViewport?.width || 1280, height: inventory.captureViewport?.height || 2120, quality: .45, confidence: .7, actions: s.actions, canEnlarge: true, animated: s.actions.some(a => a.type === 'click') }))];
}
export function direct(transcript: Transcript, inventory: Inventory): Shot[] {
  if (!transcript.segments.length || !Number.isFinite(transcript.duration) || transcript.duration <= 0) throw new Error('No valid narration timeline');
  const shots: Shot[] = []; const assets = assetsFor(inventory); const uses = new Map<string, number>();
  transcript.segments.forEach((segment, beat) => {
    const scene = inventory.scenes.find(s => s.id === segment.sceneId);
    if (!scene) throw new Error(`Missing scene ${segment.sceneId}`);
    const start = beat === 0 ? 0 : segment.start;
    const end = transcript.segments[beat + 1]?.start ?? transcript.duration;
    if (end <= start) throw new Error('Narration beats must have increasing timestamps');
    const count = Math.max(1, Math.ceil((end - start) / 4.5));
    const candidates = assets.filter(a => a.sourceId === scene.sourceId && (a.localPath || a.type === 'demo') && a.confidence >= .4);
    for (let part = 0; part < count; part++) {
      const duration = (end - start) / count;
      const slotStart = start + part * duration;
      const narration = transcript.words.filter(w => (w.start + w.end) / 2 >= slotStart && (w.start + w.end) / 2 < slotStart + duration).map(w=>w.text).join(' ') || segment.text;
      const ranked = [...candidates].sort((a, b) => {
        const score = (v: VisualAsset) => relevance(narration, `${v.description} ${v.features.join(' ')}`) * 3 + v.quality * 2 + (['image', 'gif', 'video'].includes(v.type) ? 2 : 0) - (uses.get(v.id) || 0) * 1.7 - (shots.at(-1)?.assetId === v.id ? 2 : 0);
        return score(b) - score(a);
      });
      // Include source identity once after a compelling opening, without forcing it to be the hook.
      const asset = shots.length === 1 && count > 1 ? assets.find(a => a.id === scene.id)! : ranked[0];
      if (!asset) throw new Error(`No source-backed visual for ${segment.id}`);
      const used = uses.get(asset.id) || 0; uses.set(asset.id, used + 1);
      const media = asset.type === 'image' || asset.type === 'gif';
      let type: NonNullable<Shot['type']> = media ? (used ? 'zoom_region' : 'media_fullscreen') : asset.type === 'video' ? 'video_playback' : asset.type === 'code' ? 'code_focus' : asset.type === 'demo' ? 'click_demo' : shots.length === 1 || shots.length === 0 ? 'establish' : 'feature_card';
      if (media && used > 1 && used % 2 === 0) type = 'pan_media';
      const framing = type === 'establish' || type === 'click_demo' ? 'context' : type === 'zoom_region' || type === 'code_focus' ? 'detail' : 'product';
      const motion: NonNullable<Shot['motion']> = type === 'pan_media' ? (used % 2 ? 'pan-right' : 'pan-left') : type === 'video_playback' || type === 'click_demo' ? 'hold' : shots.at(-1)?.motion === 'slow-push' ? 'slow-pull' : 'slow-push';
      shots.push({ id: String(shots.length + 1).padStart(3, '0'), sceneId: asset.sceneId, assetId: asset.id, segmentId: segment.id, narration, start: start + part * duration, duration, url: asset.pageUrl, actions: asset.actions || [], caption: asset.features[0] || scene.title, type, framing, motion, focus: type === 'zoom_region' ? asset.focus || center : asset.focus, purpose: `Show ${asset.description.slice(0, 160)} while narrating: ${narration}`, rationale: `Source ${scene.sourceId || scene.id}; semantic overlap ${relevance(narration, asset.description)}; quality ${asset.quality}; prior uses ${used}`, captionPosition: 'bottom-center', directorRevision });
    }
  });
  return repairPlan(shots, inventory, transcript);
}
const regionSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) });
const choiceSchema = z.object({ choices: z.array(z.object({ shotId: z.string(), assetId: z.string(), type: z.enum(shotTypes), purpose: z.string().min(1).max(350), rationale: z.string().max(500), focus: regionSchema.optional(), highlight: regionSchema.optional(), codeRange: z.object({ start: z.number().int().min(1).max(100), end: z.number().int().min(1).max(100) }).optional(), motion: z.enum(['hold', 'slow-push', 'slow-pull', 'pan-left', 'pan-right', 'pan-up', 'pan-down']), captionPosition: z.enum(['bottom-center', 'top-center', 'bottom-left', 'bottom-right']), diagram: z.object({ nodes: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), label: z.string().min(1).max(32) })).min(2).max(5), edges: z.array(z.object({ from: z.string(), to: z.string(), evidence: z.string().min(12).max(500) })).min(1).max(5) }).optional() })).max(80) });
export async function visualDirector(transcript: Transcript, inventory: Inventory, research: Research, jobId?: string): Promise<{ shots: Shot[]; diagnostics: DiversityReport; notes: string[] }> {
  let shots = direct(transcript, inventory); const notes: string[] = [];
  if (modelEnabled()) {
    try {
      const previews: { assetId: string; path: string }[] = [];
      if (jobId) {
        const media = (inventory.assets || []).filter(a=>['image','gif','video'].includes(a.type) && a.localPath).sort((a,b)=>relevance(transcript.segments.map(s=>s.text).join(' '),b.description)-relevance(transcript.segments.map(s=>s.text).join(' '),a.description) || b.quality-a.quality).slice(0,8);
        for (const asset of media) {
          const preview = path.join(jobDir(jobId), 'assets', `director-${asset.id}.jpg`);
          try { await run('ffmpeg',['-y','-i',path.join(jobDir(jobId),asset.localPath!),'-vf','scale=1280:960:force_original_aspect_ratio=decrease','-frames:v','1','-threads','1',preview]); previews.push({assetId:asset.id,path:preview}); }
          catch (error) { notes.push(`Cannot inspect ${asset.id}: ${(error as Error).message.slice(0,160)}`); }
        }
      }
      if (previews.length) notes.push(`Director inspected ${previews.length} attached source images: ${previews.map(p=>p.assetId).join(', ')}`);
      const result = await modelJson('Act as a tech-video director. For each fixed shot slot select a SOURCE-MATCHED visual asset and executable shot treatment. Return {choices:[{shotId,assetId,type,purpose,rationale,motion,captionPosition,focus?,highlight?,diagram?}]}. The supplied slot timings are locked to narration. Prefer a strong relevant product image as hook; introduce context afterward; use enlarged individual screenshots and feature close-ups. Focus/highlight are normalized source coordinates: use conservative regions and describe uncertainty. Use attached images to locate actual UI features when available. Attachments follow attachedImages order and refer to the full source, so focus coordinates are relative to the whole image. Never invent UI locations from metadata when an asset has no attachment. Alternate context/product/detail, use cuts and purposeful camera motion. Scroll only for explicit navigation <=3s and <20% total; no consecutive scrolls. Use only supplied assets. Diagrams are occasional, with 2–5 short labels that occur in the narrated beat; every edge must cite an exact research quote explicitly establishing that relationship. Use labels that are exact contiguous snippets of the narrated beat (use registry, not command registry, when only registry is present). No invented architecture. Type compatibility: media_fullscreen/zoom_region/pan_media/highlight=image/gif/section; video_playback=video/gif; code_focus=code; click_demo=demo; establish/scroll_to=section/demo; feature_card=section. For code_focus use codeRange:{start,end} (1-based inclusive source lines) to enlarge a short relevant excerpt, usually 3–7 lines. Never use unrelated visuals just for variety.', { research, attachedImages: previews.map((p,i)=>({ index:i+1,assetId:p.assetId })), narration: { segments: transcript.segments, words: transcript.words }, format: { width: 1080, height: 1920, fps: 30 }, assets: assetsFor(inventory), slots: shots }, choiceSchema, previews.map(p=>p.path));
      const assets = assetsFor(inventory);
      const seen = new Set<string>();
      for (const choice of result.choices) {
        const index = shots.findIndex(s => s.id === choice.shotId); const asset = assets.find(a => a.id === choice.assetId);
        if (index < 0 || !asset || seen.has(choice.shotId)) { notes.push(`Ignored unknown/duplicate choice ${choice.shotId}`); continue; }
        seen.add(choice.shotId);
        const base = shots[index]; const scene = inventory.scenes.find(s => s.id === base.sceneId)!;
        if (asset.sourceId !== scene.sourceId || !supportsType(asset, choice.type)) { notes.push(`Ignored incompatible choice ${choice.shotId}`); continue; }
        if (choice.codeRange && (asset.type !== 'code' || choice.codeRange.start > choice.codeRange.end || choice.codeRange.start > (asset.text || '').split('\n').length)) { notes.push(`Ignored invalid code excerpt ${choice.shotId}`); continue; }
        const beat = transcript.segments.find(s => s.id === base.segmentId)!;
        if (choice.type === 'diagram' && (!choice.diagram || !validDiagram(choice.diagram, beat.text, research, beat.claimIds))) { notes.push(`Ignored unsupported diagram ${choice.shotId}`); continue; }
        const { shotId: _, ...intent } = choice;
        shots[index] = { ...base, ...intent, focus: choice.focus, highlight: choice.highlight, diagram: choice.diagram, codeRange: choice.codeRange, sceneId: asset.sceneId, url: asset.pageUrl, actions: asset.actions || [], framing: choice.type === 'establish' || choice.type === 'scroll_to' || choice.type === 'click_demo' ? 'context' : ['zoom_region', 'highlight', 'code_focus'].includes(choice.type) ? 'detail' : 'product' };
      }
      shots = repairPlan(shots, inventory, transcript);
    } catch (error) { notes.push(`Model direction fell back to source-ranked plan: ${(error as Error).message}`); }
  }
  const diagnostics = validatePlan(shots, inventory, transcript);
  if (!diagnostics.passed) throw new Error(`Visual plan rejected: ${diagnostics.issues.filter(i => i.severity === 'error').map(i => i.detail).join('; ')}`);
  return { shots, diagnostics, notes };
}
export function validDiagram(diagram: NonNullable<Shot['diagram']>, narration: string, research: Research, claimIds: string[]) {
  const ids = new Set(diagram.nodes.map(n => n.id));
  return ids.size === diagram.nodes.length && diagram.nodes.every(n => narration.toLowerCase().includes(n.label.toLowerCase())) && diagram.edges.every(e => {
    const from = diagram.nodes.find(n => n.id === e.from); const to = diagram.nodes.find(n => n.id === e.to);
    return from && to && from !== to && research.claims.some(c => claimIds.includes(c.id) && c.quote.includes(e.evidence)) && e.evidence.toLowerCase().includes(from.label.toLowerCase()) && e.evidence.toLowerCase().includes(to.label.toLowerCase());
  });
}
export function supportsType(asset: VisualAsset, type: NonNullable<Shot['type']>) {
  if (type === 'diagram') return true;
  if (type === 'click_demo') return asset.type === 'demo';
  if (type === 'video_playback') return ['video', 'gif'].includes(asset.type);
  if (type === 'code_focus') return asset.type === 'code';
  if (type === 'feature_card') return asset.type === 'section';
  if (['establish', 'scroll_to'].includes(type)) return ['section', 'demo'].includes(asset.type);
  return ['image', 'gif', 'section'].includes(asset.type);
}
export function repairPlan(input: Shot[], inventory: Inventory, transcript: Transcript): Shot[] {
  let scrolling = 0; const assets = assetsFor(inventory);
  const repaired: Shot[] = [];
  const strong = assets.some(a => ['image', 'video', 'gif', 'demo'].includes(a.type));
  return input.map((original, i) => {
    const shot = { ...original }; const prior = repaired[i - 1];
    if (shot.type === 'scroll_to') {
      if (shot.duration > 3 || prior?.type === 'scroll_to' || scrolling + shot.duration > transcript.duration * .2) { shot.type = 'establish'; shot.rationale += '; navigation hidden before cut'; }
      else scrolling += shot.duration;
    }
    if (strong && i === 0 && ['establish', 'scroll_to'].includes(shot.type!)) {
      const current = assets.find(a => a.id === shot.assetId);
      const media = assets.filter(a => a.sourceId === current?.sourceId && ['image', 'gif', 'video'].includes(a.type) && a.localPath).sort((a,b) => relevance(shot.purpose || '', b.description) - relevance(shot.purpose || '', a.description) || b.quality - a.quality)[0];
      if (media) { shot.assetId = media.id; shot.sceneId = media.sceneId; shot.type = media.type === 'video' ? 'video_playback' : 'media_fullscreen'; shot.framing = 'product'; shot.url = media.pageUrl; shot.actions = []; shot.focus = media.focus; shot.highlight = undefined; shot.codeRange = undefined; shot.diagram = undefined; shot.purpose = `Open on ${media.description}`; shot.rationale += '; hook repaired to product media'; }
    }
    if (prior?.assetId === shot.assetId && prior.framing === shot.framing && prior.type === shot.type && !['video_playback', 'click_demo'].includes(shot.type!)) {
      shot.framing = shot.framing === 'detail' ? 'product' : 'detail'; shot.focus = shot.framing === 'detail' ? shot.focus || center : undefined;
      shot.rationale += '; reframed repeated source';
    }
    if (i > 1 && repaired[i - 1].motion === shot.motion && repaired[i - 2].motion === shot.motion && shot.motion !== 'hold') shot.motion = shot.motion === 'slow-push' ? 'slow-pull' : 'slow-push';
    if (shot.type === 'zoom_region' && !shot.focus) { shot.focus = assets.find(a=>a.id===shot.assetId)?.focus || center; shot.rationale += '; conservative center crop'; }
    if (shot.type === 'highlight' && !shot.highlight) { shot.type = 'zoom_region'; shot.focus ||= assets.find(a=>a.id===shot.assetId)?.focus || center; shot.rationale += '; missing highlight replaced with crop'; }
    if (shot.type === 'pan_media' && !shot.motion?.startsWith('pan-')) shot.motion = 'pan-right';
    if (shot.focus && !validRegion(shot.focus)) shot.focus = center;
    if (shot.highlight && !validRegion(shot.highlight)) shot.highlight = undefined;
    // Product media stays between safe caption bands. Bottom focal areas move captions up.
    const focal = shot.highlight || shot.focus;
    if (focal && focal.y + focal.height > .72) shot.captionPosition = 'top-center';
    if (shot.framing === 'context' && captionIntersectsFocus(shot)) { shot.captionPosition = shot.captionPosition === 'top-center' ? 'bottom-center' : 'top-center'; if (captionIntersectsFocus(shot)) { shot.framing = 'detail'; shot.type = 'highlight'; } }
    shot.captionPosition ||= 'bottom-center';
    repaired.push(shot); return shot;
  });
}
export function validRegion(region: FocusRegion) { return [region.x, region.y, region.width, region.height].every(Number.isFinite) && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0 && region.x + region.width <= 1.00001 && region.y + region.height <= 1.00001; }
export function captionIntersectsFocus(shot: Shot) {
  const focus = shot.highlight || shot.focus;
  if (!focus || shot.framing !== 'context') return false;
  const panel = panelFor(shot.framing), anchor = captionAnchor(shot.captionPosition);
  const y = panel.y + focus.y * panel.height, bottom = y + focus.height * panel.height;
  const captionTop = anchor.alignment === 8 ? anchor.y : anchor.y - 140;
  return y < captionTop + 140 && bottom > captionTop;
}
export function validatePlan(shots: Shot[], inventory: Inventory, transcript: Transcript): DiversityReport {
  const issues: DiversityReport['issues'] = []; const assets = assetsFor(inventory); let scrolling = 0;
  const add = (code: string, detail: string, shotId?: string, severity: 'error' | 'warning' = 'error') => issues.push({ code, detail, shotId, severity });
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i], previous = shots[i - 1]; const asset = assets.find(a => a.id === s.assetId);
    if (!Number.isFinite(s.start) || !Number.isFinite(s.duration) || s.duration <= 0 || Math.abs(s.start - (previous ? previous.start + previous.duration : 0)) > .02) add('timeline', 'Visual timeline has a gap/overlap or invalid duration', s.id);
    if (s.duration > 6) add('long-shot', 'Unchanged composition exceeds six seconds', s.id);
    if (!asset || !s.type || !supportsType(asset, s.type)) add('asset', 'Missing asset or unsupported shot treatment', s.id);
    if (!s.purpose || !transcript.segments.some(b => b.id === s.segmentId)) add('support', 'Shot has no narrated beat or visual intent', s.id);
    const beat = transcript.segments.find(b => b.id === s.segmentId); const scene = inventory.scenes.find(c => c.id === beat?.sceneId);
    if (asset && beat && !['establish','diagram'].includes(s.type!) && relevance(beat.text, `${asset.description} ${asset.features.join(' ')}`) === 0) add('weak-support', 'Visual has no lexical feature match to this narrated beat; review its semantic support', s.id, 'warning');
    if (asset && scene && asset.sourceId !== scene.sourceId) add('source', 'Visual belongs to a different source from narration', s.id);
    if (captionIntersectsFocus(s)) add('caption-focus', 'Caption overlaps intended focal area', s.id);
    if (s.codeRange && (s.codeRange.start > s.codeRange.end || s.codeRange.start < 1)) add('code-range', 'Code excerpt has invalid line range', s.id);
    if (s.focus && !validRegion(s.focus) || s.highlight && !validRegion(s.highlight)) add('focus', 'Focal coordinates exceed source bounds', s.id);
    if (s.type === 'scroll_to') { scrolling += s.duration; if (s.duration > 3) add('scroll-length', 'Visible scrolling exceeds three seconds', s.id); if (previous?.type === 'scroll_to') add('consecutive-scroll', 'Consecutive scrolling shots', s.id); }
    if (previous?.assetId === s.assetId && previous.framing === s.framing && previous.type === s.type && JSON.stringify([previous.focus,previous.highlight,previous.codeRange,previous.diagram]) === JSON.stringify([s.focus,s.highlight,s.codeRange,s.diagram])) add('repeated-framing', 'Repeated source with identical composition', s.id, 'warning');
    let unchanged = s.duration;
    for (let j = i - 1; j >= 0; j--) {
      const p = shots[j];
      if (p.assetId !== s.assetId || p.framing !== s.framing || p.type !== s.type || JSON.stringify([p.focus,p.highlight,p.codeRange,p.diagram]) !== JSON.stringify([s.focus,s.highlight,s.codeRange,s.diagram])) break;
      unchanged += p.duration;
    }
    if (unchanged > 6) add('unchanged-composition', 'Identical source/framing held across cuts for more than six seconds', s.id);
    if (i >= 2 && shots[i - 2].assetId === s.assetId && previous.assetId === s.assetId) add('repeated-source', 'Same visual source for three successive shots', s.id, 'warning');
    if (i >= 2 && shots[i-2].motion === s.motion && previous.motion === s.motion) add('repeated-motion', 'Three successive identical camera motions', s.id, 'warning');
    if (asset && ['image', 'gif'].includes(asset.type) && (asset.width < 480 || asset.height < 240)) add('resolution', 'Product image may be unreadable at delivery size', s.id, 'warning');
  }
  if (scrolling > transcript.duration * .2 + .01) add('scroll-budget', 'Visible scrolling exceeds 20% of runtime');
  if (!shots.length || Math.abs(shots.at(-1)!.start + shots.at(-1)!.duration - transcript.duration) > .05) add('coverage', 'Shot plan does not cover narration');
  if (shots[0]?.type === 'scroll_to') add('hook', 'Opening shows generic navigation');
  const passed = !issues.some(i => i.severity === 'error');
  return { passed, score: Math.max(0, 100 - issues.reduce((n, i) => n + (i.severity === 'error' ? 20 : 5), 0)), scrollDuration: scrolling, issues };
}
