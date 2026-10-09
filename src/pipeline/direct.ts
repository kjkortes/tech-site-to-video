import path from 'node:path';
import { jobDir } from '../lib/store';
import { run } from '../lib/process';
import { panelFor } from './video-layout';
import { verticalSafeArea, intersects, safeVisual } from './safe-area';
import { validateCoverage, SupportRequest, supportFor } from './coverage';
import { z } from 'zod';
import { Inventory, Shot, Transcript, Research, VisualAsset, FocusRegion, shotTypes, DiversityReport } from '../lib/types';
import { modelEnabled, modelJson, creativeInstruction } from '../lib/llm';

export const directorRevision = 7;
import { assetsFor, relevance } from './visual-utils';
export { assetsFor, relevance } from './visual-utils';
import { directWalkthrough, validateContinuity, localAsset } from './walkthrough';
import { pagesFor } from './document-map';
import { exitLocation, validatePageMotion } from './page-motion';
import { validateCameraPlan } from './camera-policy';
import { readableCodeRange } from './source-code';
import { eligibleVisual, codeVisualsAllowed, promotionalPolicy } from './content-policy';
import { projectedFocus, focalIsSafe, cameraMode } from './framing';
export function direct(transcript: Transcript, inventory: Inventory, requests:SupportRequest[]=[]): Shot[] {
  return repairPlan(directWalkthrough(transcript,inventory,requests),inventory,transcript);
}
const regionSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) });
const choiceSchema = z.object({ supports: z.array(z.object({beatId:z.string(),assetId:z.string(),supportedText:z.string().min(1),claimIds:z.array(z.string()).min(1),relevanceReason:z.string().min(20).max(700)})).max(12).optional(), choices: z.array(z.object({ shotId: z.string(), assetId: z.string(), type: z.enum(shotTypes), purpose: z.string().min(1).max(350), rationale: z.string().max(500), cameraReason: z.string().min(15).optional(), detailText: z.string().min(3).optional(), focus: regionSchema.optional(), highlight: regionSchema.optional(), codeRange: z.object({ start: z.number().int().min(1).max(100), end: z.number().int().min(1).max(100) }).optional(), motion: z.enum(['hold', 'slow-push', 'slow-pull', 'pan-left', 'pan-right', 'pan-up', 'pan-down']), captionPosition: z.literal('bottom-center'), diagram: z.object({ nodes: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), label: z.string().min(1).max(32) })).min(2).max(5), edges: z.array(z.object({ from: z.string(), to: z.string(), evidence: z.string().min(12).max(500) })).min(1).max(5) }).optional() })).max(80) });
export async function visualDirector(transcript: Transcript, inventory: Inventory, research: Research, jobId?: string): Promise<{ shots: Shot[]; diagnostics: DiversityReport; notes: string[] }> {
  let shots = direct(transcript, inventory); const notes: string[] = [];
  if (modelEnabled()) {
    try {
      const previews: { assetId: string; path: string }[] = [];
      if (jobId) {
        const media = (inventory.assets || []).filter(a=>eligibleVisual(a,inventory.contentMode) && ['image','gif','video','code'].includes(a.type) && a.localPath).sort((a,b)=>relevance(transcript.segments.map(s=>s.text).join(' '),b.description)-relevance(transcript.segments.map(s=>s.text).join(' '),a.description) || b.quality-a.quality).slice(0,8);
        for (const asset of media) {
          const preview = path.join(jobDir(jobId), 'assets', `director-${asset.id}.jpg`);
          try { await run('ffmpeg',['-y','-i',path.join(jobDir(jobId),asset.localPath!),'-vf','scale=1280:960:force_original_aspect_ratio=decrease','-frames:v','1','-threads','1',preview]); previews.push({assetId:asset.id,path:preview}); }
          catch (error) { notes.push(`Cannot inspect ${asset.id}: ${(error as Error).message.slice(0,160)}`); }
        }
      }
      if (previews.length) notes.push(`Director inspected ${previews.length} attached source images: ${previews.map(p=>p.assetId).join(', ')}`);
      const result = await modelJson('Direct a natural source walkthrough. Return {supports?:[{beatId,assetId,supportedText,claimIds,relevanceReason}],choices:[{shotId,assetId,type,purpose,rationale,motion,captionPosition,focus?,highlight?,cameraReason?,detailText?,codeRange?,diagram?}]}. Priorities in order: spatial continuity, narration relevance, readability, source evidence, pacing, variation. The first visual MUST be the source page: repository/README beginning for GitHub, homepage hero for websites, landing/title for documentation. Intro and browser visit order are locked. WALKTHROUGH is native portrait page scale with no artificial zoom. Use ESTABLISH, SCROLL to a destination in 0.5–1.5 seconds, PAUSE, optional MEDIA/DETAIL, RETURN to the same page section. MEDIA initially contains the full screenshot; landscape sources are fit-width, never cover cropped. Keep one source visible for its complete exact narration phrase. No random movement. DETAIL is optional only for an explicitly narrated small feature identified in an inspected image. Supply exact detailText from narration and cameraReason explaining what the viewer should inspect, plus focus in full normalized source coordinates. Detail pushes are at most 1.12x and brief; the app establishes wide before and returns wide afterward. Never crop a paragraph or assign zoom to every screenshot. Refine only supplied cutaway slots for the same asset. Static page/media views are acceptable. Promotional mode disables raw code, commands, JSON, CLI and generated code cards; show prose or actual UI instead. Captions stay bottom-center in their fixed safe zone. Preserve supported facts, word timestamps, full explanation dwell, exact browser return targets and real source media. README establishes context; source product media owns the full relevant explanation. Preserve the planned hero ending and intentional hero reuse. Diagram edges require cited quotes and narrated labels', { policy:inventory.contentMode==='developer'||inventory.contentMode==='tutorial'?'Developer/tutorial source walkthrough':promotionalPolicy, research, attachedImages: previews.map((p,i)=>({ index:i+1,assetId:p.assetId })), narration: { segments: transcript.segments, words: transcript.words }, document: pagesFor(inventory), format: { width: 1080, height: 1920, fps: 30, safeArea:verticalSafeArea }, assets: assetsFor(inventory), slots: shots.filter(s=>['hook','cutaway','ending'].includes(s.walkthrough?.role||'')) }, choiceSchema, previews.map(p=>p.path), 'visual');
      const assets = assetsFor(inventory);
      const priorSlots=shots;
      if(result.supports?.length) {
        const valid:SupportRequest[]=[];
        for(const request of result.supports) {
          const beat=transcript.segments.find(b=>b.id===request.beatId),asset=assets.find(a=>a.id===request.assetId),section=pagesFor(inventory).flatMap(p=>p.sections).find(s=>s.id===beat?.sectionId || s.sceneId===beat?.sceneId);
          if(!beat || !asset || !section || !localAsset(asset,section,inventory) || request.claimIds.some(id=>!beat.claimIds.includes(id)) || asset.type==='code' && !/\b(cli|command|install|api|registry|architecture|config|mcp|script|json)\b/i.test(beat.text)) {notes.push(`Ignored unsupported visual phrase ${request.beatId}`);continue;}
          try {
            const support=supportFor(transcript,beat,asset,request,beat.start,beat.end);
            if(!request.claimIds.length || asset.confidence<.4)throw new Error('No confident claim-backed source');
            const prefix=beat.text.slice(0,beat.text.indexOf(request.supportedText));
            if(prefix.split(/\s+/).length>8 && relevance(prefix,asset.features.join(' '))>0)throw new Error('Visual arrives after the same feature was already explained');
            // Narrow spans cannot silently drop the remainder of the same feature explanation.
            const tail=beat.text.slice(beat.text.indexOf(request.supportedText)+request.supportedText.length).trim();
            if(tail && !/^(?:But|However|There(?:'s| is) one catch|It(?:'s| is) still|Keep its|For a different)\b/i.test(tail))throw new Error('Support omits dependent feature explanation');
            if(support.transcriptEnd-support.transcriptStart<3 && beat.end-beat.start>5)throw new Error('Fragment is too short to explain this visual');
            valid.push(request);
          }catch(error){notes.push(`Ignored incomplete visual support ${request.beatId}: ${(error as Error).message}`);}
        }
        if(valid.length){const proposed=direct(transcript,inventory,valid);if(validatePlan(proposed,inventory,transcript).passed){shots=proposed;notes.push(`Aligned ${valid.length} model-selected source explanations to the transcript.`);}else notes.push('Support refinements broke coverage/continuity; kept complete beat support.');}
      }
      const seen = new Set<string>();
      for (const choice of result.choices) {
        let index = shots.findIndex(s => s.id === choice.shotId); const previousSlot=priorSlots.find(s=>s.id===choice.shotId);
        if(previousSlot?.support) {
          const support=previousSlot.support,progress=(previousSlot.start+previousSlot.duration/2-support.visualStart)/(support.visualEnd-support.visualStart);
          const candidates=shots.map((shot,i)=>({shot,i})).filter(v=>v.shot.segmentId===previousSlot.segmentId && v.shot.walkthrough?.role===previousSlot.walkthrough?.role && [previousSlot.assetId,choice.assetId].includes(v.shot.assetId));
          candidates.sort((a,b)=>Math.abs((a.shot.start+a.shot.duration/2-a.shot.support!.visualStart)/(a.shot.support!.visualEnd-a.shot.support!.visualStart)-progress)-Math.abs((b.shot.start+b.shot.duration/2-b.shot.support!.visualStart)/(b.shot.support!.visualEnd-b.shot.support!.visualStart)-progress));
          if(candidates[0])index=candidates[0].i;
        }
        const asset = assets.find(a => a.id === choice.assetId);
        if (index < 0 || !asset || !eligibleVisual(asset,inventory.contentMode) || seen.has(shots[index]?.id)) { notes.push(`Ignored unknown/duplicate choice ${choice.shotId}`); continue; }
        seen.add(shots[index].id);
        const base = shots[index];
        if(base.walkthrough?.role==='ending' && !['developer','tutorial'].includes(inventory.contentMode||'promotional') && ['zoom_region','pan_media','highlight','diagram','code_focus'].includes(choice.type)){notes.push(`Ignored detail treatment on calm hero ending ${choice.shotId}`);continue;}
        if(base.walkthrough) {
          const section=pagesFor(inventory).flatMap(p=>p.sections).find(s=>s.id===base.walkthrough!.location.sectionId)!;
          if(!['hook','cutaway','ending'].includes(base.walkthrough.role) || base.walkthrough.role==='cutaway' && !localAsset(asset,section,inventory) || ['walkthrough','establish','scroll_to','feature_card'].includes(choice.type) || ['hook','ending'].includes(base.walkthrough.role) && !['image','gif','video','demo'].includes(asset.type)) {notes.push(`Ignored continuity-breaking choice ${choice.shotId}`);continue;}
        }
        const scene = inventory.scenes.find(s => s.id === base.sceneId)!;
        if (asset.sourceId !== scene.sourceId || !supportsType(asset, choice.type) || base.support && base.assetId!==choice.assetId) { notes.push(`Ignored incompatible choice ${choice.shotId}`); continue; }
        if (choice.type==='code_focus' && !/\b(cli|command|install|api|registry|architecture|config|mcp|script|json)\b/i.test(transcript.segments.find(s=>s.id===base.segmentId)?.text||'')) {notes.push(`Ignored unrelated code ${choice.shotId}`);continue;}
        if (choice.codeRange && (asset.type !== 'code' || choice.codeRange.start > choice.codeRange.end || choice.codeRange.end > (asset.text || '').split('\n').length)) { notes.push(`Ignored invalid code excerpt ${choice.shotId}`); continue; }
        const beat = transcript.segments.find(s => s.id === base.segmentId)!;
        if (choice.type === 'diagram' && (!choice.diagram || !validDiagram(choice.diagram, beat.text, research, beat.claimIds))) { notes.push(`Ignored unsupported diagram ${choice.shotId}`); continue; }
        const { shotId: _, ...intent } = choice;
        shots[index] = { ...base, ...intent, cameraMode:['zoom_region','pan_media','highlight'].includes(choice.type)?'detail':base.cameraMode, camera:choice.cameraReason && choice.detailText?{motion:'slow-push',duration:base.duration,offset:0,maxZoom:1.08,reason:choice.cameraReason,detailText:choice.detailText,focus:choice.focus||choice.highlight}:undefined, focus: choice.focus, highlight: choice.highlight, diagram: choice.diagram, codeRange: choice.codeRange?readableCodeRange(asset,choice.codeRange):base.codeRange, sceneId: asset.sceneId, url: asset.pageUrl, actions: asset.actions || [], framing: choice.type === 'establish' || choice.type === 'scroll_to' || choice.type === 'click_demo' ? 'context' : ['zoom_region', 'highlight', 'code_focus'].includes(choice.type) ? 'detail' : 'product' };
      }
      shots = repairPlan(shots, inventory, transcript);
      if (!validatePlan(shots, inventory, transcript).passed) {
        notes.push(`Model refinements failed plan validation (${validatePlan(shots,inventory,transcript).issues.filter(i=>i.severity==='error').map(i=>i.code+': '+i.shotId).join(', ')}); retained the ordered source walkthrough.`);
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
  let scrolling=0;
  const result:Shot[]=[];
  for(const original of input) {
    const shot:Shot={...original,contentMode:inventory.contentMode||'promotional',captionPosition:'bottom-center'};
    if(shot.type==='scroll_to') {
      if(shot.duration>3 || result.at(-1)?.type==='scroll_to' || scrolling+shot.duration>transcript.duration*.35)shot.type='establish';
      else scrolling+=shot.duration;
    }
    const mode=cameraMode(shot),beat=transcript.segments.find(b=>b.id===shot.segmentId);
    const explicit=mode==='detail' && shot.camera?.reason && shot.camera.detailText && beat?.text.includes(shot.camera.detailText) && (shot.camera.focus||shot.focus||shot.highlight);
    if(mode==='walkthrough') {
      shot.mediaMotion=undefined;shot.cameraMode='walkthrough';shot.framing='context';shot.camera=undefined;shot.focus=undefined;shot.highlight=undefined;shot.motion='hold';
    } else if(!explicit) {
      if(shot.walkthrough)shot.walkthrough={...shot.walkthrough,pageMotion:undefined};
      shot.cameraMode='media';shot.camera=undefined;shot.focus=undefined;shot.highlight=undefined;shot.motion='hold';
      if(['zoom_region','pan_media','highlight'].includes(shot.type||''))shot.type='media_fullscreen';
      if(shot.type!=='code_focus')shot.framing='product';
    } else {
      shot.mediaMotion=undefined;shot.cameraMode='detail';shot.framing='detail';shot.motion='slow-push';
      shot.camera={...shot.camera!,motion:'slow-push',offset:0,duration:shot.duration,maxZoom:Math.min(1.12,Math.max(1,shot.camera!.maxZoom??1.08))};
      // Expand a requested detail into context → short inspection → context,
      // preserving the exact asset, support span and narration timeline.
      if(shot.duration>=7) {
        const wide=(start:number,duration:number):Shot=>({...shot,start,duration,type:shot.type==='video_playback'?'video_playback':'media_fullscreen',cameraMode:'media',framing:'product',camera:undefined,focus:undefined,highlight:undefined,motion:'hold',sourceOffset:(shot.sourceOffset||0)+start-shot.start});
        const lead=2.5,detail=Math.min(3,shot.duration-5);
        result.push(wide(shot.start,lead));
        result.push({...shot,start:shot.start+lead,duration:detail,sourceContext:false,sourceOffset:(shot.sourceOffset||0)+lead,camera:{...shot.camera,duration:detail}});
        result.push({...wide(shot.start+lead+detail,shot.duration-lead-detail),sourceContext:false});continue;
      }
    }
    if(shot.focus && !validRegion(shot.focus))shot.focus=undefined;
    if(shot.highlight && !validRegion(shot.highlight))shot.highlight=undefined;
    result.push(shot);
  }
  // Split camera poses preserve the same browser state; update links and IDs.
  let current:import('../lib/types').WalkLocation|undefined;
  for(let i=0;i<result.length;i++) {
    const shot=result[i];shot.id=String(i+1).padStart(3,'0');
    shot.narration=transcript.words.filter(w=>(w.start+w.end)/2>=shot.start && (w.start+w.end)/2<shot.start+shot.duration).map(w=>w.text).join(' ')||transcript.segments.find(b=>b.id===shot.segmentId)?.text;
    if(shot.walkthrough) {
      shot.walkthrough={...shot.walkthrough,previousLocation:current,nextLocation:result.slice(i+1).find(s=>s.cameraMode==='walkthrough')?.walkthrough?.location};
      if(shot.cameraMode==='walkthrough' || shot.sourceContext)current=exitLocation(shot);
    }
  }
  return result;
}
export function validRegion(region: FocusRegion) { return [region.x, region.y, region.width, region.height].every(Number.isFinite) && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0 && region.x + region.width <= 1.00001 && region.y + region.height <= 1.00001; }
export function captionIntersectsFocus(shot: Shot, asset?:VisualAsset) {
  const rect=projectedFocus(shot,asset||{width:1280,height:2276});
  return !!rect && intersects(verticalSafeArea.captions,rect);
}
export function validatePlan(shots: Shot[], inventory: Inventory, transcript: Transcript): DiversityReport {
  const issues: DiversityReport['issues'] = []; const assets = assetsFor(inventory); let scrolling = 0;
  const add = (code: string, detail: string, shotId?: string, severity: 'error' | 'warning' = 'error') => issues.push({ code, detail, shotId, severity });
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i], previous = shots[i - 1]; const asset = assets.find(a => a.id === s.assetId);
    if (!Number.isFinite(s.start) || !Number.isFinite(s.duration) || s.duration <= 0 || Math.abs(s.start - (previous ? previous.start + previous.duration : 0)) > .02) add('timeline', 'Visual timeline has a gap/overlap or invalid duration', s.id);
    if(s.duration>8 && !s.support && s.type!=='walkthrough')add('long-shot','Unsupported composition exceeds eight seconds',s.id,'warning');
    if (!asset || !s.type || !supportsType(asset, s.type)) add('asset', 'Missing asset or unsupported shot treatment', s.id);
    if (!s.purpose || !transcript.segments.some(b => b.id === s.segmentId)) add('support', 'Shot has no narrated beat or visual intent', s.id);
    const beat = transcript.segments.find(b => b.id === s.segmentId); const scene = inventory.scenes.find(c => c.id === beat?.sceneId);
    if (asset && beat && !['hook','ending'].includes(s.walkthrough?.role||'') && !['walkthrough','establish','diagram'].includes(s.type!) && relevance(beat.text, `${asset.description} ${asset.features.join(' ')}`) === 0) add('weak-support', 'Visual has no lexical feature match to this narrated beat; review its semantic support', s.id, 'warning');
    if (asset && scene && asset.sourceId !== scene.sourceId && !s.intro) add('source', 'Visual belongs to a different source from narration', s.id);
    if (captionIntersectsFocus(s,asset)) add('caption-focus', 'Caption overlaps intended focal area', s.id);
    if(s.captionPosition!=='bottom-center')add('caption-zone','Captions must use the fixed lower safe zone',s.id);
    if(!safeVisual(panelFor(s.framing)))add('full-bleed-scale','Primary content occupies too little of the video viewport',s.id);
    if((s.type==='code_focus'||asset?.type==='code') && !codeVisualsAllowed(inventory.contentMode))add('promotional-code','Code visuals are disabled in promotional mode',s.id);
    if(s.contextPreview)add('media-isolation','README origin insets are forbidden in isolated media shots',s.id);
    if(asset && !focalIsSafe(s,asset))add('focal-safe','Reframe the source feature above subtitles and left of social controls',s.id);
    if (s.codeRange && (s.codeRange.start > s.codeRange.end || s.codeRange.start < 1)) add('code-range', 'Code excerpt has invalid line range', s.id);
    if (s.focus && !validRegion(s.focus) || s.highlight && !validRegion(s.highlight)) add('focus', 'Focal coordinates exceed source bounds', s.id);
    if (s.type === 'scroll_to') { scrolling += s.duration; if (s.duration > 3) add('scroll-length', 'Visible scrolling exceeds three seconds', s.id); if (previous?.type === 'scroll_to') add('consecutive-scroll', 'Consecutive scrolling shots', s.id); }
    const composition = (shot: Shot) => JSON.stringify([shot.assetId,shot.framing,shot.type,shot.focus,shot.highlight,shot.codeRange,shot.diagram,shot.walkthrough?.location.selector,shot.walkthrough?.location.scrollY]);
    if (previous && s.type !== 'walkthrough' && !s.retention?.intentionalReuse && composition(previous) === composition(s)) add('repeated-framing', 'Repeated source with identical composition', s.id, 'warning');
    if (asset && ['image', 'gif'].includes(asset.type) && (asset.width < 480 || asset.height < 240)) add('resolution', 'Product image may be unreadable at delivery size', s.id, 'warning');
  }
  scrolling += shots.reduce((n,s)=>n+(s.walkthrough?.transition?.duration||0),0);
  if (scrolling > transcript.duration * .35 + .01) add('scroll-budget', 'Visible scrolling exceeds 35% of runtime');
  if (shots.some(s=>s.walkthrough)) {issues.push(...validateContinuity(shots,inventory,transcript).issues,...validateCoverage(shots,inventory,transcript).issues);}
  if (!shots.length || Math.abs(shots.at(-1)!.start + shots.at(-1)!.duration - transcript.duration) > .05) add('coverage', 'Shot plan does not cover narration');
  const motion=validatePageMotion(shots,inventory,transcript);
  issues.push(...motion.issues);scrolling+=shots.reduce((n,s)=>n+(s.walkthrough?.pageMotion?.motionDuration||0),0);
  issues.push(...validateCameraPlan(shots,inventory,transcript).issues);
  if (shots[0]?.type === 'scroll_to') add('hook', 'Opening shows generic navigation');
  const passed = !issues.some(i => i.severity === 'error');
  return { passed, score: Math.max(0, 100 - issues.reduce((n, i) => n + (i.severity === 'error' ? 20 : 2), 0)), scrollDuration: scrolling, issues };
}
