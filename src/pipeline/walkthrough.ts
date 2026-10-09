import type { ContinuityReport, Inventory, PageSection, Shot, Transcript, VisualAsset, WalkLocation } from '../lib/types';
import { locationFor, pagesFor, entryPageFor } from './document-map';
import { assetsFor, relevance } from './visual-utils';
import { defaultSupport, supportFor, SupportRequest } from './coverage';
import type { VisualSupport } from '../lib/types';
import { codeLines } from './source-code';
import { codeVisualsAllowed, eligibleVisual } from './content-policy';

import { planPageMotion, exitLocation } from './page-motion';
import { selectHeroAssets, overviewEvidence, finalTakeaway, planMediaMotion, featureMediaMatch } from './product-media';

const mediaTypes=['image','gif','video','demo'];
const technical=/\b(cli|commands?|terminal|install|api|registry|architecture|config|mcp|script|json|wasm|webassembly)\b/i;
export function localAsset(asset: VisualAsset, section: PageSection, inventory: Inventory) {
  if(asset.sectionId===section.id) return true;
  const sections=pagesFor(inventory).flatMap(p=>p.sections);
  let owner=sections.find(s=>s.id===asset.sectionId);
  while(owner?.parentId && section.order>0) {if(owner.parentId===section.id)return true;owner=sections.find(s=>s.id===owner!.parentId);}
  return false;
}
export function directWalkthrough(transcript: Transcript, inventory: Inventory, requests: SupportRequest[]=[]): Shot[] {
  if(!transcript.segments.length || !Number.isFinite(transcript.duration) || transcript.duration<=0) throw new Error('No valid narration timeline');
  const pages=pagesFor(inventory),assets=assetsFor(inventory),shots:Shot[]=[];
  const promotional=!['developer','tutorial'].includes(inventory.contentMode||'promotional');
  const heroes=selectHeroAssets(inventory);Object.assign(inventory,heroes);
  let current:WalkLocation|undefined;
  function append(start:number,duration:number,beat:Transcript['segments'][number],location:WalkLocation,role:NonNullable<Shot['walkthrough']>['role'],asset:VisualAsset,type:NonNullable<Shot['type']>,transition?:NonNullable<Shot['walkthrough']>['transition'],support?:VisualSupport,preview?:string) {
    if(duration<.001)return;
    const cutaway=['hook','cutaway','ending'].includes(role);
    shots.push({id:String(shots.length+1).padStart(3,'0'),assetId:asset.id,sceneId:asset.sceneId,segmentId:beat.id,start,duration,url:cutaway?asset.pageUrl:location.url,actions:cutaway?asset.actions||[]:[],type,framing:cutaway?type==='zoom_region'||type==='code_focus'?'detail':'product':'context',cameraMode:cutaway?'media':'walkthrough',motion:'hold',focus:type==='zoom_region'?asset.focus||{x:.08,y:.08,width:.84,height:.84}:undefined,caption:location.heading,captionPosition:'bottom-center',purpose:`${role==='context'?'Walk through':role==='return'?'Return to':role==='hook'?'Introduce product with':role==='ending'?'Conclude with the product after':'Show a contextual detail from'} ${location.heading}`,rationale:support?.relevanceReason||`Stable browser context: ${asset.description.slice(0,180)}; section ${location.sectionIndex}; continuity before variety`,directorRevision:7,retention:{role:role==='ending'?'hero':cutaway?'evidence':'context'},contentMode:inventory.contentMode||'promotional',support,sourceContext:!!preview,sourceOffset:support?start-support.visualStart:undefined,walkthrough:{visitId:beat.visitId||beat.id,location,role,previousLocation:current,returnTarget:cutaway?location:undefined,transition}});
    if(!cutaway || preview)current=location;
  }
  function contexts(start:number,end:number,beat:Transcript['segments'][number],location:WalkLocation,asset:VisualAsset,role:'context'|'return',transition?:NonNullable<Shot['walkthrough']>['transition']) {
    if(end-start<.001)return;
    const duration=end-start;
    const target=current?.sectionId===location.sectionId && (current.selector===location.selector || current.offsetY!==undefined || role==='return')?current:location;
    const movement=current && duration>=2 && current.pageId===target.pageId && Math.abs(current.scrollY-target.scrollY)>180?{from:current,duration:Math.min(.9,duration*.3)}:undefined;
    const initial=transition||movement;
    append(start,duration,beat,target,role,asset,'walkthrough',initial && duration>=2?{...initial,duration:Math.min(initial.duration,duration*.4)}:undefined);
    const shot=shots.at(-1)!,section=pages.find(p=>p.id===target.pageId)?.sections.find(s=>s.id===target.sectionId);
    const used=shots.reduce((n,s)=>n+(s.walkthrough?.pageMotion?.motionDuration||0)+(s.walkthrough?.transition?.duration||0),0);
    // Final caveat/payoff settles. Returns restore the exact captured origin.
    const ending=beat.id===transcript.segments.at(-1)?.id && transcript.segments.length>1;
    if(section && role==='context' && !ending)shot.walkthrough!.pageMotion=planPageMotion(section,target,duration,shot.walkthrough!.transition?.duration||0,Math.max(0,transcript.duration*.58-used));
    if(!shot.walkthrough!.pageMotion && duration>=4.8)shot.retention!.staticHoldReason=ending?'Caveat/status context needs a readable hold before the takeaway.':'No useful section corridor or movement budget; retain relevant context rather than unrelated motion.';
    current=exitLocation(shot);
  }
  function media(support:VisualSupport,beat:Transcript['segments'][number],location:WalkLocation,role:'hook'|'cutaway'|'ending',asset:VisualAsset,preview?:string) {
    const duration=support.visualEnd-support.visualStart;
    // One source sustains the explanation. Camera cuts direct attention without changing the supporting visual.
    const animated=['video','gif','demo'].includes(asset.type),code=asset.type==='code';
    const count=1;
    for(let i=0;i<count;i++) {
      const start=support.visualStart+duration*i/count,span=duration/count;
      append(start,span,beat,location,role,asset,code?'code_focus':asset.type==='demo'?'click_demo':animated?'video_playback':'media_fullscreen',undefined,support,i===0?preview:undefined);
      const shot=shots.at(-1)!;
      if(code)shot.codeRange=codeLines(asset,beat.text);
      else if(promotional)shot.mediaMotion=planMediaMotion(asset,span,role==='ending'?'hero':'evidence',support.supportedText);
      if(role==='ending')shot.retention!.intentionalReuse=shots.slice(0,-1).some(s=>s.assetId===asset.id);
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
    const local=assets.filter(a=>a.sourceId===section.sourceId && eligibleVisual(a,inventory.contentMode) && localAsset(a,section,inventory) && a.confidence>=.4 && (a.localPath||a.type==='demo') && (mediaTypes.includes(a.type) || a.type==='code' && codeVisualsAllowed(inventory.contentMode) && technical.test(beat.text)));
    const rank=(a:VisualAsset)=>relevance(beat.text,`${a.description} ${a.features.join(' ')} ${a.type==='code'?a.text||'':''}`)*2+a.quality+(a.type==='gif'||a.type==='video'?1:0);
    local.sort((a,b)=>rank(b)-rank(a));
    if(index===0) {
      // Source selection is deterministic and cannot be replaced by visual scoring.
      const entryPage=entryPageFor(inventory,page);
      if(!entryPage)throw new Error('The source landing page is missing; cannot replace the establishing intro with another document');
      const entry=entryPage.sections[0],entryAsset=assets.find(a=>a.id===entry.sceneId)||context;
      const intro={...locationFor(entryPage,entry),url:entryPage.url.split('#')[0]};
      if(new URL(intro.url).hostname!=='github.com') {intro.selector='html';intro.scrollY=0;}
      const establishEnd=location.sectionId===intro.sectionId && (new URL(intro.url).hostname==='github.com' || location.scrollY===0)?end:Math.min(end,Math.max(3,span*.5));
      contexts(start,establishEnd,beat,intro,entryAsset,'context');
      shots.forEach(s=>s.intro=true);
      const movement=current && current.pageId===location.pageId && location.sectionId!==intro.sectionId?{from:current,duration:Math.min(1.2,(end-establishEnd)*.3)}:undefined;
      contexts(establishEnd,end,beat,location,context,'context',movement);return;
    }
    // Return to the exact browser origin after a media explanation, before moving on.
    let contextualStart=start;
    const prior=shots.at(-1);
    const takeaway=promotional && index===transcript.segments.length-1?finalTakeaway(beat):undefined;
    const hero=assets.find(a=>a.id===heroes.heroAsset && a.sourceId===section.sourceId);
    if(takeaway && hero && span>=3) {
      const support=supportFor(transcript,beat,hero,{beatId:beat.id,assetId:hero.id,supportedText:takeaway,claimIds:beat.claimIds,relevanceReason:'Return to the strongest source product UI to reinforce the final takeaway; intentional reuse creates payoff, not a new feature claim.'},start,end);
      support.visualRole='product-context';support.visualEnd=end;
      if(support.visualEnd-support.visualStart>=3) {
        if(support.visualStart-start>=.8)contexts(start,support.visualStart,beat,location,context,'context',transition);
        else {support.visualStart=start;}
        media(support,beat,current?.sectionId===section.id?current:location,'ending',hero);return;
      }
    }
    const navigation=current && current.pageId===location.pageId && current.sectionId!==location.sectionId?{from:current,duration:Math.min(1.2,span*.15)}:transition;
    const requested=requests.find(r=>r.beatId===beat.id),chosen=requested?local.find(a=>a.id===requested.assetId):local.find(a=>defaultSupport(beat,a) && (!promotional || a.type==='code' || featureMediaMatch(beat.text,a)))||(promotional?overviewEvidence(beat,section,inventory):undefined);
    const request=requested||chosen && defaultSupport(beat,chosen);
    if(chosen && request) {
      const support=supportFor(transcript,beat,chosen,request,start,end);
      if(!localAsset(chosen,section,inventory)){support.visualRole='product-context';support.relevanceReason+=' This overview supplies product context for the visible workflow; the README remains the source of the compatibility/statistical claim.';}
      if(support.visualStart-start<.8)support.visualStart=start;
      if(end-support.visualEnd<.8)support.visualEnd=end;
      if((support.visualStart-contextualStart>=.8 || support.visualStart===start) && support.visualEnd-support.visualStart>=Math.min(support.minReadability,chosen.type==='code'?4:3)) {
        // Keep the source association in metadata when narration enters directly; no visual inset.
        const introduced=support.visualStart-start>=.35;
        if(prior?.walkthrough?.role==='cutaway' && current && support.visualStart-start>=2.2) {
          const duration=Math.min(1.0,(support.visualStart-start)*.3),originAsset=assets.find(a=>a.type==='section' && a.sectionId===current!.sectionId)!;
          contexts(start,start+duration,beat,current,originAsset,'return');contextualStart+=duration;
        }
        const origin=chosen.type==='code' && chosen.selector?{...location,selector:chosen.selector,scrollY:chosen.scrollY??location.scrollY}:location;
        contexts(contextualStart,support.visualStart,beat,origin,context,'context',navigation);
        media(support,beat,current?.sectionId===location.sectionId?current:origin,'cutaway',chosen,introduced?undefined:scene.screenshot);
        contexts(support.visualEnd,end,beat,origin,context,'return');return;
      }
    }
    contexts(contextualStart,end,beat,location,context,'context',navigation);
  });
  shots.forEach((s,i)=>{s.id=String(i+1).padStart(3,'0');s.narration=transcript.words.filter(w=>(w.start+w.end)/2>=s.start && (w.start+w.end)/2<s.start+s.duration).map(w=>w.text).join(' ')||transcript.segments.find(b=>b.id===s.segmentId)!.text;s.walkthrough!.nextLocation=shots.slice(i+1).find(n=>['context','return'].includes(n.walkthrough!.role))?.walkthrough!.location;});
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
    if(beat?.sectionId && beat.sectionId!==section.id && !shot.intro && walk.role!=='return')add('narration-location','Shot location conflicts with the narrated section',shot.id);
    if(!sameLocation(walk.previousLocation,current))add('previous-location','Stored previous location does not match the walkthrough state',shot.id);
    if(cut) {
      if(['hook','ending'].includes(walk.role) && (!asset || !mediaTypes.includes(asset.type)))add('product-bookend','Product hook/payoff must use actual product media',shot.id);
      cutawayDuration+=shot.duration;withoutContext+=shot.duration;
      if(shot.sourceContext || shot.contextPreview){
        if(page.order<currentPage || current?.pageId===page.id && walk.location.sectionIndex<current.sectionIndex)add('backward-travel','Source inset moves backward through the document',shot.id);
        current=walk.location;currentPage=page.order;introduced.add(walk.visitId);withoutContext=0;
      }
      if(walk.role==='cutaway') {
        if(!asset||!localAsset(asset,section,inventory) && !(shot.support?.visualRole==='product-context' && asset.sourceId===section.sourceId))add('foreign-cutaway','Media does not belong to the active section',shot.id);
        if(!introduced.has(walk.visitId) && !shot.sourceContext && !shot.contextPreview && !shots.some(s=>s.support?.id===shot.support?.id && (s.sourceContext || s.contextPreview)))add('unintroduced-cutaway','Cutaway has no browser introduction in this visit',shot.id);
        if(!sameLocation(walk.returnTarget,walk.location) || current?.sectionId===section.id && !sameLocation(walk.location,current))add('return-target','Cutaway does not retain its exact browser return target',shot.id);
        if(shot.type==='code_focus' && !technical.test(transcript.segments.find(b=>b.id===shot.segmentId)?.text||''))add('isolated-code','Code is unrelated to the narrated technical topic',shot.id);
      }
      if(withoutContext>16)add('context-gap','More than sixteen seconds without browser context; inspect whether a return would help',shot.id,'warning');
    } else {
      if(!['walkthrough','establish','scroll_to','click_demo'].includes(shot.type||'') || shot.framing!=='context')add('context-mode','Browser visit was replaced with a disconnected asset',shot.id);
      browserDuration+=shot.duration;withoutContext=0;
      if(page.order<currentPage || current && current.pageId===page.id && walk.location.sectionIndex<current.sectionIndex)add('backward-travel','Walkthrough moves backward through the document',shot.id);
      if(walk.location.scrollY<0 || !shot.intro && walk.location.scrollY<section.scrollY-2)add('backward-travel','Browser start is before its owned section',shot.id);
      if(current?.sectionId===section.id && walk.location.scrollY<current.scrollY-2)add('backward-travel','Walkthrough moves backward within a section',shot.id);
      if(walk.location.sectionIndex!==section.order)add('location-index','Stored section index conflicts with the document map',shot.id);
      if(asset?.sectionId!==section.id)add('context-section','Browser context belongs to a different section',shot.id);
      if(walk.role==='return' && !sameLocation(current,walk.location))add('disoriented-return','Cutaway does not restore the same browser framing',shot.id);
      if(walk.transition && (walk.transition.duration>Math.min(2,shot.duration) || walk.transition.duration<.3 || !sameLocation(walk.transition.from,current) || walk.transition.from.pageId!==page.id))add('navigation','Transition exceeds its narration slot or does not start at the previous browser location',shot.id);
      current=exitLocation(shot);currentPage=page.order;introduced.add(walk.visitId);
    }
  }
  if(['developer','tutorial'].includes(inventory.contentMode||'promotional') && browserDuration<transcript.duration*.5)add('context-balance','Less than half the runtime is on the actual page; inspect walkthrough continuity.',undefined,'warning');
  if(cutawayDuration<transcript.duration*.15 && inventory.assets?.some(a=>mediaTypes.includes(a.type)))add('few-cutaways','Few local media cutaways; document may have sparse section-associated media',undefined,'warning');
  return {passed:!issues.some(i=>i.severity==='error'),score:Math.max(0,100-issues.reduce((n,i)=>n+(i.severity==='error'?20:3),0)),browserDuration,cutawayDuration,issues};
}
