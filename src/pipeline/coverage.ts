import type { CoverageReport, Inventory, Research, Shot, Transcript, VisualAsset, VisualSupport } from '../lib/types';
import { assetsFor, relevance } from './visual-utils';

export interface SupportRequest {
  beatId: string; assetId: string; supportedText: string; claimIds: string[]; relevanceReason: string;
}
const tokens=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).filter(Boolean);
export function spokenRange(transcript:Transcript,beat:Transcript['segments'][number],text:string) {
  const wanted=tokens(text),all=transcript.words.filter(w=>w.start>=beat.start-.1 && w.start<beat.end+.05).flatMap(w=>tokens(w.text).map(token=>({token,start:w.start,end:w.end})));
  for(let i=0;i<=all.length-wanted.length;i++) if(wanted.length && wanted.every((t,j)=>all[i+j].token===t))return {start:all[i].start,end:all[i+wanted.length-1].end,timingSource:'words' as const};
  const spoken=tokens(beat.text);const offset=spoken.findIndex((_,i)=>wanted.every((t,j)=>spoken[i+j]===t));
  if(offset<0 || !wanted.length)throw new Error('Visual support is not an exact phrase from its narration beat');
  return {start:beat.start+(beat.end-beat.start)*offset/spoken.length,end:beat.start+(beat.end-beat.start)*(offset+wanted.length)/spoken.length,timingSource:'segment-estimate' as const};
}
export function defaultSupport(beat:Transcript['segments'][number],asset:VisualAsset):SupportRequest|undefined {
  if(relevance(beat.text,`${asset.description} ${asset.features.join(' ')} ${asset.text||''}`)===0)return;
  // Introductory connective wording belongs on the README; keep the full dependent explanation after it.
  const connector=/^(?:For [^,]{1,45},|On [^,]{1,45},|When [^,]{1,45},|From there,|For the next step,|But [^,]{1,45},|Under the hood,|The interesting part is[^:]{0,35}:)\s*/i.exec(beat.text);
  const label=!connector?/^[^,:.!?]{1,45}:\s*/.exec(beat.text):null;
  const introSentence=!connector && !label?beat.text.match(/^([^.!?]+[.!?])\s+(.+)$/):null;
  const supportedText=connector?beat.text.slice(connector[0].length):label?beat.text.slice(label[0].length):introSentence && introSentence[1].split(/\s+/).length<=8?introSentence[2]:beat.text;
  return {beatId:beat.id,assetId:asset.id,supportedText,claimIds:beat.claimIds,relevanceReason:`Source ${asset.type} from this section demonstrates ${asset.features.filter(f=>relevance(supportedText,f)>0).join(', ')||asset.description.slice(0,160)}; full source media is clearer than the page thumbnail.`};
}
export function supportFor(transcript:Transcript,beat:Transcript['segments'][number],asset:VisualAsset,request:SupportRequest,slotStart:number,slotEnd:number):VisualSupport {
  const range=spokenRange(transcript,beat,request.supportedText);
  const minReadability=asset.type==='code'?5:asset.type==='video'||asset.type==='gif'||asset.type==='demo'?4:asset.width>=1400?4:3;
  return {id:`${beat.id}:${asset.id}:${range.start.toFixed(3)}`,beatId:beat.id,assetId:asset.id,sourceSectionId:asset.sectionId||beat.sectionId||beat.sceneId,claimIds:request.claimIds,supportedText:request.supportedText,transcriptStart:range.start,transcriptEnd:range.end,visualStart:Math.max(slotStart,range.start-.2),visualEnd:Math.min(slotEnd,range.end+.4),minReadability,relevanceReason:request.relevanceReason,timingSource:range.timingSource};
}
export function validateCoverage(shots:Shot[],inventory:Inventory,transcript:Transcript,research?:Research):CoverageReport {
  const issues:CoverageReport['issues']=[],groups:VisualSupport[]=[],assets=assetsFor(inventory);
  const add=(code:string,detail:string,shotId?:string,severity:'error'|'warning'='error')=>issues.push({code,detail,shotId,severity});
  for(const shot of shots)if(['hook','cutaway','ending'].includes(shot.walkthrough?.role||'') && !shot.support)add('unexplained-cutaway','Cutaway has no explicit narrated phrase, claim, section, or relevance reason',shot.id);
  for(const support of new Map(shots.filter(s=>s.support).map(s=>[s.support!.id,s.support!])).values()) {
    groups.push(support);const group=shots.filter(s=>s.support?.id===support.id),first=group[0],asset=assets.find(a=>a.id===support.assetId),beat=transcript.segments.find(b=>b.id===support.beatId);
    if(!asset || !beat || group.some(s=>s.assetId!==support.assetId || s.segmentId!==support.beatId || JSON.stringify(s.support)!==JSON.stringify(support))){add('support-identity','Source/beat identity changes within a narrated visual group',first.id);continue;}
    if(!support.relevanceReason.trim() || (research && research.claims.length>0 && !support.claimIds.length) || support.claimIds.some(id=>!beat.claimIds.includes(id) || research && !research.claims.some(c=>c.id===id && c.sourceId===asset.sourceId)))add('support-evidence','Cutaway does not explain a cited claim from its narration/source',first.id);
    if(asset.sectionId!==support.sourceSectionId)add('support-section','Visual support names a different source section',first.id);
    try {
      const range=spokenRange(transcript,beat,support.supportedText);
      if(Math.abs(range.start-support.transcriptStart)>.05 || Math.abs(range.end-support.transcriptEnd)>.05)add('support-timestamps','Stored support does not match spoken word timestamps',first.id);
    }catch(e){add('support-phrase',(e as Error).message,first.id);}
    let cursor=support.visualStart;
    for(const shot of group){if(Math.abs(shot.start-cursor)>.025)add('support-gap','Relevant source disappears between camera shots',shot.id);cursor=shot.start+shot.duration;}
    if(first.start>support.transcriptStart+.025 || cursor<support.transcriptEnd-.025 || Math.abs(cursor-support.visualEnd)>.025)add('visual-coverage','Supporting media does not cover its entire spoken explanation',first.id);
    const dwell=cursor-first.start;
    if(dwell<support.minReadability-.05)add('readability-time',`${asset.type} has only ${dwell.toFixed(1)}s for inspection (suggested ${support.minReadability}s); narration remains the master timeline`,first.id,'warning');
    if(first.walkthrough?.role==='ending' && dwell<2.5)add('short-payoff','Ending product payoff is too brief to register',first.id,'warning');
    if(support.timingSource!=='words')add('estimated-support','No exact word alignment; visual conservatively uses estimated segment timing',first.id,'warning');
  }
  return {passed:!issues.some(i=>i.severity==='error'),groups,issues};
}
