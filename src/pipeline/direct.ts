import path from 'node:path';
import { jobDir } from '../lib/store';
import { run } from '../lib/process';
import { panelFor } from './video-layout';
import { captionAnchor } from './captions';
import { z } from 'zod';
import { Inventory, Shot, Transcript, Research, VisualAsset, FocusRegion, shotTypes, DiversityReport } from '../lib/types';
import { modelEnabled, modelJson, creativeInstruction } from '../lib/llm';

export const directorRevision = 2;
const center: FocusRegion = { x: .12, y: .12, width: .76, height: .76 };
import { assetsFor, relevance } from './visual-utils';
export { assetsFor, relevance } from './visual-utils';
import { directWalkthrough, validateContinuity, localAsset } from './walkthrough';
import { pagesFor } from './document-map';
export function direct(transcript: Transcript, inventory: Inventory): Shot[] {
  return repairPlan(directWalkthrough(transcript,inventory),inventory,transcript);
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
      const result = await modelJson('Refine a guided walkthrough plan. Browser section visits, document order, slot timings, state, and return targets are LOCKED. Return {choices:[{shotId,assetId,type,purpose,rationale,motion,captionPosition,focus?,highlight?,codeRange?,diagram?}]} ONLY for supplied hook/cutaway/ending slots. Select media from the active section or its nested subsections, never a distant section. Hook may show the strongest product media before browser context. Prioritize relevant live demos, video/GIF, screenshots; code only for the narrated CLI/API/installation/architecture topic AFTER its page context. Retain narration as master audio. Choose hold unless motion directs attention. Attached previews show full source coordinates; never guess UI locations without a preview. Regions are normalized. Use conservative crops, subtle emphasis, and safe captions. Diagram edges must cite exact quotes explicitly establishing the relationship and use short labels from narration. Generated cards are fallback only. Never request navigation changes or visual alternation for its own sake. Keep the same source and framing when that communicates the section better.', { research, attachedImages: previews.map((p,i)=>({ index:i+1,assetId:p.assetId })), narration: { segments: transcript.segments, words: transcript.words }, document: pagesFor(inventory), format: { width: 1080, height: 1920, fps: 30 }, assets: assetsFor(inventory), slots: shots.filter(s=>['hook','cutaway','ending'].includes(s.walkthrough?.role||'')) }, choiceSchema, previews.map(p=>p.path), 'visual');
      const assets = assetsFor(inventory);
      const seen = new Set<string>();
      for (const choice of result.choices) {
        const index = shots.findIndex(s => s.id === choice.shotId); const asset = assets.find(a => a.id === choice.assetId);
        if (index < 0 || !asset || seen.has(choice.shotId)) { notes.push(`Ignored unknown/duplicate choice ${choice.shotId}`); continue; }
        seen.add(choice.shotId);
        const base = shots[index];
        if(base.walkthrough) {
          const section=pagesFor(inventory).flatMap(p=>p.sections).find(s=>s.id===base.walkthrough!.location.sectionId)!;
          if(!['hook','cutaway','ending'].includes(base.walkthrough.role) || base.walkthrough.role==='cutaway' && !localAsset(asset,section,inventory) || ['walkthrough','establish','scroll_to','feature_card'].includes(choice.type) || ['hook','ending'].includes(base.walkthrough.role) && !['image','gif','video','demo'].includes(asset.type)) {notes.push(`Ignored continuity-breaking choice ${choice.shotId}`);continue;}
        }
        const scene = inventory.scenes.find(s => s.id === base.sceneId)!;
        if (asset.sourceId !== scene.sourceId || !supportsType(asset, choice.type)) { notes.push(`Ignored incompatible choice ${choice.shotId}`); continue; }
        if (choice.type==='code_focus' && !/\b(cli|command|install|api|registry|architecture|config|mcp|script|json)\b/i.test(transcript.segments.find(s=>s.id===base.segmentId)?.text||'')) {notes.push(`Ignored unrelated code ${choice.shotId}`);continue;}
        if (choice.codeRange && (asset.type !== 'code' || choice.codeRange.start > choice.codeRange.end || choice.codeRange.start > (asset.text || '').split('\n').length)) { notes.push(`Ignored invalid code excerpt ${choice.shotId}`); continue; }
        const beat = transcript.segments.find(s => s.id === base.segmentId)!;
        if (choice.type === 'diagram' && (!choice.diagram || !validDiagram(choice.diagram, beat.text, research, beat.claimIds))) { notes.push(`Ignored unsupported diagram ${choice.shotId}`); continue; }
        const { shotId: _, ...intent } = choice;
        shots[index] = { ...base, ...intent, focus: choice.focus, highlight: choice.highlight, diagram: choice.diagram, codeRange: choice.codeRange, sceneId: asset.sceneId, url: asset.pageUrl, actions: asset.actions || [], framing: choice.type === 'establish' || choice.type === 'scroll_to' || choice.type === 'click_demo' ? 'context' : ['zoom_region', 'highlight', 'code_focus'].includes(choice.type) ? 'detail' : 'product' };
      }
      shots = repairPlan(shots, inventory, transcript);
      if (!validatePlan(shots, inventory, transcript).passed) {
        notes.push('Model refinements failed plan validation; retained the ordered source walkthrough.');
        shots = direct(transcript, inventory);
      }
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
  if (['walkthrough', 'establish', 'scroll_to'].includes(type)) return ['section', 'demo'].includes(asset.type);
  return ['image', 'gif', 'section'].includes(asset.type);
}
export function repairPlan(input: Shot[], inventory: Inventory, transcript: Transcript): Shot[] {
  let scrolling = 0; const assets = assetsFor(inventory);
  const repaired: Shot[] = [];
  const strong = assets.some(a => ['image', 'video', 'gif', 'demo'].includes(a.type));
  return input.map((original, i) => {
    const shot = { ...original }; const prior = repaired[i - 1];
    if (shot.type === 'scroll_to') {
      if (shot.duration > 3 || prior?.type === 'scroll_to' || scrolling + shot.duration > transcript.duration * .35) { shot.type = 'establish'; shot.rationale += '; navigation hidden before cut'; }
      else scrolling += shot.duration;
    }
    if (!shot.walkthrough && strong && i === 0 && ['establish', 'scroll_to'].includes(shot.type!)) {
      const current = assets.find(a => a.id === shot.assetId);
      const media = assets.filter(a => a.sourceId === current?.sourceId && ['image', 'gif', 'video'].includes(a.type) && a.localPath).sort((a,b) => relevance(shot.purpose || '', b.description) - relevance(shot.purpose || '', a.description) || b.quality - a.quality)[0];
      if (media) { shot.assetId = media.id; shot.sceneId = media.sceneId; shot.type = media.type === 'video' ? 'video_playback' : 'media_fullscreen'; shot.framing = 'product'; shot.url = media.pageUrl; shot.actions = []; shot.focus = media.focus; shot.highlight = undefined; shot.codeRange = undefined; shot.diagram = undefined; shot.purpose = `Open on ${media.description}`; shot.rationale += '; hook repaired to product media'; }
    }
    if (!shot.walkthrough && prior?.assetId === shot.assetId && prior.framing === shot.framing && prior.type === shot.type && !['video_playback', 'click_demo'].includes(shot.type!)) {
      shot.framing = shot.framing === 'detail' ? 'product' : 'detail'; shot.focus = shot.framing === 'detail' ? shot.focus || center : undefined;
      shot.rationale += '; reframed repeated source';
    }
    if (!shot.walkthrough && i > 1 && repaired[i - 1].motion === shot.motion && repaired[i - 2].motion === shot.motion && shot.motion !== 'hold') shot.motion = shot.motion === 'slow-push' ? 'slow-pull' : 'slow-push';
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
    if (s.duration > 6) add('long-shot', 'Shot exceeds six seconds', s.id);
    if (!asset || !s.type || !supportsType(asset, s.type)) add('asset', 'Missing asset or unsupported shot treatment', s.id);
    if (!s.purpose || !transcript.segments.some(b => b.id === s.segmentId)) add('support', 'Shot has no narrated beat or visual intent', s.id);
    const beat = transcript.segments.find(b => b.id === s.segmentId); const scene = inventory.scenes.find(c => c.id === beat?.sceneId);
    if (asset && beat && !['hook','ending'].includes(s.walkthrough?.role||'') && !['walkthrough','establish','diagram'].includes(s.type!) && relevance(beat.text, `${asset.description} ${asset.features.join(' ')}`) === 0) add('weak-support', 'Visual has no lexical feature match to this narrated beat; review its semantic support', s.id, 'warning');
    if (asset && scene && asset.sourceId !== scene.sourceId) add('source', 'Visual belongs to a different source from narration', s.id);
    if (captionIntersectsFocus(s)) add('caption-focus', 'Caption overlaps intended focal area', s.id);
    if (s.codeRange && (s.codeRange.start > s.codeRange.end || s.codeRange.start < 1)) add('code-range', 'Code excerpt has invalid line range', s.id);
    if (s.focus && !validRegion(s.focus) || s.highlight && !validRegion(s.highlight)) add('focus', 'Focal coordinates exceed source bounds', s.id);
    if (s.type === 'scroll_to') { scrolling += s.duration; if (s.duration > 3) add('scroll-length', 'Visible scrolling exceeds three seconds', s.id); if (previous?.type === 'scroll_to') add('consecutive-scroll', 'Consecutive scrolling shots', s.id); }
    const composition = (shot: Shot) => JSON.stringify([shot.assetId,shot.framing,shot.type,shot.focus,shot.highlight,shot.codeRange,shot.diagram,shot.walkthrough?.location.selector,shot.walkthrough?.location.scrollY]);
    if (previous && s.type !== 'walkthrough' && composition(previous) === composition(s)) add('repeated-framing', 'Repeated source with identical composition', s.id, 'warning');
    let unchanged = s.duration;
    for (let j = i - 1; j >= 0; j--) {
      const p = shots[j];
      if (composition(p) !== composition(s)) break;
      unchanged += p.duration;
    }
    if (unchanged > 6 && s.type !== 'walkthrough') add('unchanged-composition', 'Identical cutaway held for more than six seconds', s.id);
    if (unchanged > 10 && s.type === 'walkthrough') add('long-context', 'Page held for more than ten seconds; review whether a local detail would help', s.id, 'warning');
    if (!s.walkthrough && i >= 2 && shots[i - 2].assetId === s.assetId && previous.assetId === s.assetId) add('repeated-source', 'Same visual source for three successive shots', s.id, 'warning');
    if (!s.walkthrough && i >= 2 && shots[i-2].motion === s.motion && previous.motion === s.motion) add('repeated-motion', 'Three successive identical camera motions', s.id, 'warning');
    if (asset && ['image', 'gif'].includes(asset.type) && (asset.width < 480 || asset.height < 240)) add('resolution', 'Product image may be unreadable at delivery size', s.id, 'warning');
  }
  scrolling += shots.reduce((n,s)=>n+(s.walkthrough?.transition?.duration||0),0);
  if (scrolling > transcript.duration * .35 + .01) add('scroll-budget', 'Visible scrolling exceeds 35% of runtime');
  if (shots.some(s=>s.walkthrough)) issues.push(...validateContinuity(shots,inventory,transcript).issues);
  if (!shots.length || Math.abs(shots.at(-1)!.start + shots.at(-1)!.duration - transcript.duration) > .05) add('coverage', 'Shot plan does not cover narration');
  if (shots[0]?.type === 'scroll_to') add('hook', 'Opening shows generic navigation');
  const passed = !issues.some(i => i.severity === 'error');
  return { passed, score: Math.max(0, 100 - issues.reduce((n, i) => n + (i.severity === 'error' ? 20 : 2), 0)), scrollDuration: scrolling, issues };
}
