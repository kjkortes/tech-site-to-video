import type { ContinuityReport, Inventory, PageSection, Shot, Transcript, VisualAsset, WalkLocation } from '../lib/types';
import { locationFor, pagesFor } from './document-map';
import { assetsFor, relevance } from './visual-utils';

const mediaTypes=['image','gif','video','demo'];
const technical=/\b(cli|command|terminal|install|api|registry|architecture|config|mcp|script|json|wasm|webassembly)\b/i;
export function localAsset(asset: VisualAsset, section: PageSection, inventory: Inventory) {
  if(asset.sectionId===section.id) return true;
  const sections=pagesFor(inventory).flatMap(p=>p.sections);
  let owner=sections.find(s=>s.id===asset.sectionId);
  while(owner?.parentId && section.order>0) {if(owner.parentId===section.id)return true;owner=sections.find(s=>s.id===owner!.parentId);}
  return false;
}
export function directWalkthrough(transcript: Transcript, inventory: Inventory): Shot[] {
  if(!transcript.segments.length || !Number.isFinite(transcript.duration) || transcript.duration<=0) throw new Error('No valid narration timeline');
  const pages=pagesFor(inventory),assets=assetsFor(inventory),shots:Shot[]=[];
  let current:WalkLocation|undefined;
  function append(start:number,duration:number,beat:Transcript['segments'][number],location:WalkLocation,role:NonNullable<Shot['walkthrough']>['role'],asset:VisualAsset,type:NonNullable<Shot['type']>,transition?:NonNullable<Shot['walkthrough']>['transition']) {
    const cutaway=['hook','cutaway','ending'].includes(role);
    const narration=transcript.words.filter(w=>(w.start+w.end)/2>=start && (w.start+w.end)/2<start+duration).map(w=>w.text).join(' ')||beat.text;
    shots.push({id:String(shots.length+1).padStart(3,'0'),assetId:asset.id,sceneId:asset.sceneId,segmentId:beat.id,start,duration,narration,url:cutaway?asset.pageUrl:location.url,actions:cutaway?asset.actions||[]:[],type,framing:cutaway?type==='zoom_region'||type==='code_focus'?'detail':'product':'context',motion:cutaway && type==='zoom_region'?'slow-push':'hold',focus:type==='zoom_region'?asset.focus||{x:.12,y:.12,width:.76,height:.76}:undefined,caption:location.heading,captionPosition:'bottom-center',purpose:`${role==='context'?'Walk through':role==='return'?'Return to':role==='hook'?'Introduce product with':role==='ending'?'Conclude with the product after':'Show a contextual detail from'} ${location.heading}: ${narration}`,rationale:`${cutaway?'Source cutaway':'Stable browser context'}: ${asset.description.slice(0,180)}; active section ${location.sectionIndex}; asset section ${asset.sectionId}; continuity before variety`,directorRevision:2,walkthrough:{visitId:beat.visitId||beat.id,location,role,previousLocation:current,returnTarget:cutaway?location:undefined,transition}});
    if(!cutaway)current=location;
  }
  function contexts(start:number,end:number,beat:Transcript['segments'][number],location:WalkLocation,asset:VisualAsset,role:'context'|'return',transition?:NonNullable<Shot['walkthrough']>['transition']) {
    const count=Math.max(1,Math.ceil((end-start)/4.5));
    for(let i=0;i<count;i++) {
      const slotStart=start+(end-start)*i/count,duration=(end-start)/count;
      let target=(role==='return'||i>0) && current?.sectionId===location.sectionId?current:location;
      const spoken=transcript.words.filter(w=>(w.start+w.end)/2>=slotStart && (w.start+w.end)/2<slotStart+duration).map(w=>w.text).join(' ');
      const section=pages.flatMap(p=>p.sections).find(s=>s.id===location.sectionId);
      if(i>0 && spoken) {
        const candidates=(section?.anchors||[]).filter(a=>a.scrollY>=(current?.sectionId===location.sectionId?current.scrollY:location.scrollY)).sort((a,b)=>relevance(spoken,b.text)-relevance(spoken,a.text));
        if(candidates[0] && relevance(spoken,candidates[0].text)>=2)target={...location,selector:candidates[0].selector,scrollY:candidates[0].scrollY};
      }
      const movement=current && duration>=1 && current.pageId===target.pageId && Math.abs(current.scrollY-target.scrollY)>180?{from:current,duration:Math.min(.9,duration*.3)}:undefined;
      append(slotStart,duration,beat,target,i===0?role:'context',asset,'walkthrough',i===0?transition:movement);
    }
  }
  transcript.segments.forEach((beat,index)=>{
    const scene=inventory.scenes.find(s=>s.id===beat.sceneId);if(!scene)throw new Error(`Missing scene ${beat.sceneId}`);
    const page=pages.find(p=>p.sections.some(s=>s.id===(beat.sectionId||scene.sectionId||scene.id)))||pages.find(p=>p.sourceId===scene.sourceId)!;
    const section=page?.sections.find(s=>s.id===(beat.sectionId||scene.sectionId||scene.id))||page?.sections.find(s=>s.sceneId===scene.id)||page?.sections[0];
    if(!page || !section)throw new Error('Narration has no page section');
    const location=locationFor(page,section),context=assets.find(a=>a.id===(section.sceneId||scene.id))!;
    if(!context)throw new Error(`Section ${section.id} has no clean capture target`);
    const start=index===0?0:beat.start,end=transcript.segments[index+1]?.start??transcript.duration,span=end-start;
    if(span<=0)throw new Error('Narration beats must have increasing timestamps');
    const transition=current && span>=2 && current.pageId===location.pageId && current.sectionId!==location.sectionId?{from:current,duration:Math.min(1.2,span*.15)}:undefined;
    const local=assets.filter(a=>localAsset(a,section,inventory) && a.confidence>=.4 && (a.localPath||a.type==='demo') && (mediaTypes.includes(a.type) || a.type==='code' && technical.test(beat.text)));
    const rank=(a:VisualAsset)=>relevance(beat.text,`${a.description} ${a.features.join(' ')}`)*2+a.quality+(a.type==='gif'||a.type==='video'?1:0);
    local.sort((a,b)=>rank(b)-rank(a));
    if(index===0) {
      const hero=assets.filter(a=>a.sourceId===scene.sourceId && mediaTypes.includes(a.type) && a.confidence>=.4 && (a.localPath||a.type==='demo')).sort((a,b)=>rank(b)-rank(a))[0];
      if(hero && span>3) {const duration=Math.min(2,span*.25);append(start,duration,beat,location,'hook',hero,hero.type==='video'||hero.type==='gif'?'video_playback':hero.type==='demo'?'click_demo':'media_fullscreen');contexts(start+duration,end,beat,location,context,'context');return;}
    }
    const cut=local[0];
    if(cut && span>=5.5) {
      const duration=Math.min(3.2,Math.max(2,span*.3)),before=Math.min(4.5,(span-duration)*.56),cutStart=start+before;
      contexts(start,cutStart,beat,location,context,'context',transition);
      append(cutStart,duration,beat,current||location,'cutaway',cut,cut.type==='code'?'code_focus':cut.type==='video'||cut.type==='gif'?'video_playback':cut.type==='demo'?'click_demo':cut.focus?'zoom_region':'media_fullscreen');
      contexts(cutStart+duration,end,beat,location,context,'return');
    } else contexts(start,end,beat,location,context,'context',transition);
  });
  const last=shots.at(-1);
  const payoff=shots[0]?.walkthrough?.role==='hook'?assets.find(a=>a.id===shots[0].assetId):undefined;
  if(last && payoff && payoff.sourceId===assets.find(a=>a.id===last.assetId)?.sourceId && last.duration>Math.max(2.5,2+(last.walkthrough?.transition?.duration||0)+.3) && ['context','return'].includes(last.walkthrough?.role||'')) {
    const endingStart=last.start+last.duration-2;last.duration-=2;
    const beat=transcript.segments.find(b=>b.id===last.segmentId)!;
    append(endingStart,2,beat,last.walkthrough!.location,'ending',payoff,payoff.type==='gif'||payoff.type==='video'?'video_playback':payoff.type==='demo'?'click_demo':'media_fullscreen');
    shots.at(-1)!.rationale='Brief product payoff from the opening; the browser remains at its final section, with no backward navigation';
  }
  shots.forEach((s,i)=>{s.narration=transcript.words.filter(w=>(w.start+w.end)/2>=s.start && (w.start+w.end)/2<s.start+s.duration).map(w=>w.text).join(' ')||transcript.segments.find(b=>b.id===s.segmentId)!.text;s.walkthrough!.nextLocation=shots.slice(i+1).find(n=>['context','return'].includes(n.walkthrough!.role))?.walkthrough!.location;});
  return shots;
}
export function validateContinuity(shots:Shot[],inventory:Inventory,transcript:Transcript):ContinuityReport {
  const issues:ContinuityReport['issues']=[],assets=assetsFor(inventory),pages=pagesFor(inventory);let current:WalkLocation|undefined;let currentPage=-1,browserDuration=0,cutawayDuration=0,withoutContext=0;
  const introduced=new Set<string>();
  const sameLocation=(a:WalkLocation|undefined,b:WalkLocation|undefined)=>a?.pageId===b?.pageId && a?.sectionId===b?.sectionId && a?.selector===b?.selector && a?.scrollY===b?.scrollY;
  const add=(code:string,detail:string,shotId?:string,severity:'error'|'warning'='error')=>issues.push({code,detail,shotId,severity});
  for(const shot of shots) {
    const walk=shot.walkthrough;if(!walk){add('missing-state','Shot has no walkthrough state',shot.id);continue;}
    const page=pages.find(p=>p.id===walk.location.pageId),section=page?.sections.find(s=>s.id===walk.location.sectionId),asset=assets.find(a=>a.id===shot.assetId);
    if(!page||!section){add('missing-section','Unknown active page section',shot.id);continue;}
    const cut=['hook','cutaway','ending'].includes(walk.role);
    const beat=transcript.segments.find(b=>b.id===shot.segmentId);
    if(beat?.sectionId && beat.sectionId!==section.id)add('narration-location','Shot location conflicts with the narrated section',shot.id);
    if(!sameLocation(walk.previousLocation,current))add('previous-location','Stored previous location does not match the walkthrough state',shot.id);
    if(cut) {
      if(['hook','ending'].includes(walk.role) && (shot.duration>3 || !asset || !mediaTypes.includes(asset.type)))add('product-bookend','Product hook/payoff must use brief actual product media',shot.id);
      cutawayDuration+=shot.duration;withoutContext+=shot.duration;
      if(walk.role==='cutaway') {
        if(!asset||!localAsset(asset,section,inventory))add('foreign-cutaway','Media does not belong to the active section',shot.id);
        if(!introduced.has(walk.visitId))add('unintroduced-cutaway','Cutaway has no browser introduction in this visit',shot.id);
        if(!sameLocation(walk.location,current) || !sameLocation(walk.returnTarget,current))add('return-target','Cutaway does not retain its exact browser return target',shot.id);
        if(shot.type==='code_focus' && !technical.test(transcript.segments.find(b=>b.id===shot.segmentId)?.text||''))add('isolated-code','Code is unrelated to the narrated technical topic',shot.id);
      }
      if(withoutContext>8)add('context-gap','More than eight seconds without browser context',shot.id);
    } else {
      if(!['walkthrough','establish','scroll_to','click_demo'].includes(shot.type||'') || shot.framing!=='context')add('context-mode','Browser visit was replaced with a disconnected asset',shot.id);
      browserDuration+=shot.duration;withoutContext=0;
      if(page.order<currentPage || current && current.pageId===page.id && walk.location.sectionIndex<current.sectionIndex)add('backward-travel','Walkthrough moves backward through the document',shot.id);
      if(current?.sectionId===section.id && walk.location.scrollY<current.scrollY-2)add('backward-travel','Walkthrough moves backward within a section',shot.id);
      if(walk.location.sectionIndex!==section.order)add('location-index','Stored section index conflicts with the document map',shot.id);
      if(asset?.sectionId!==section.id)add('context-section','Browser context belongs to a different section',shot.id);
      if(walk.role==='return' && !sameLocation(current,walk.location))add('disoriented-return','Cutaway does not restore the same browser framing',shot.id);
      if(walk.transition && (walk.transition.duration>Math.min(2,shot.duration) || walk.transition.duration<.3 || !sameLocation(walk.transition.from,current) || walk.transition.from.pageId!==page.id))add('navigation','Transition exceeds its narration slot or does not start at the previous browser location',shot.id);
      current=walk.location;currentPage=page.order;introduced.add(walk.visitId);
    }
  }
  if(browserDuration<transcript.duration*.55)add('cutaway-budget','Cutaways dominate the walkthrough');
  else if(browserDuration<transcript.duration*.6)add('context-balance','Less than 60% browser context; inspect the balance',undefined,'warning');
  if(cutawayDuration<transcript.duration*.15 && inventory.assets?.some(a=>mediaTypes.includes(a.type)))add('few-cutaways','Few local media cutaways; document may have sparse section-associated media',undefined,'warning');
  return {passed:!issues.some(i=>i.severity==='error'),score:Math.max(0,100-issues.reduce((n,i)=>n+(i.severity==='error'?20:3),0)),browserDuration,cutawayDuration,issues};
}
