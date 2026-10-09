import type { DiversityReport, Inventory, Script, Shot, Transcript } from '../lib/types';
import { validateCoverage } from './coverage';
import {productOpening} from './script-quality';
import { validateCameraPlan } from './camera-policy';
import { assetsFor } from './visual-utils';
import { pagesFor } from './document-map';
import { localAsset } from './walkthrough';
import { selectHeroAssets, productMedia, overviewEvidence, visibleFeature, finalTakeaway, featureMediaMatch } from './product-media';

export function validateRetention(shots:Shot[],inventory:Inventory,transcript:Transcript,script?:Script):DiversityReport {
  const issues:DiversityReport['issues']=[],opening=shots[0];
  let metrics:DiversityReport['retention'];
  const add=(code:string,detail:string,shotId?:string,severity:'error'|'warning'='warning')=>issues.push({code,detail,shotId,severity});
  issues.push(...validateCameraPlan(shots,inventory,transcript).issues);
  if(!productOpening(transcript.segments[0]?.text||'',script?.title))add('product-first','Opening does not immediately identify/explain the product',opening?.id);
  const coverage=validateCoverage(shots,inventory,transcript);
  issues.push(...coverage.issues.filter(i=>['readability-time','short-payoff','visual-coverage','unexplained-cutaway'].includes(i.code)));
  if(script && script.segments.filter(s=>/^(?:It (?:has|also|supports)|Also,|Another feature)/i.test(s.text)).length>=3)add('flat-enumeration','Several visits read as a feature list; connect the ideas and remove minor details');
  if(script?.outline && script.outline.visits.length>=4 && !script.outline.visits.slice(1,-1).some(v=>['technical','proof','surprise'].includes(v.storyRole||'')))add('middle-progression','Middle visits need a concrete proof/differentiator, when supported by the source');
  if(!['developer','tutorial'].includes(inventory.contentMode||'promotional')) {
    const assets=assetsFor(inventory),sections=pagesFor(inventory).flatMap(p=>p.sections),heroes=selectHeroAssets(inventory);
    const activeTime=(start:number,end:number)=>transcript.segments.reduce((n,b)=>n+Math.max(0,Math.min(end,b.end)-Math.max(start,b.start)),0);
    const pageShot=(s:Shot)=>s.cameraMode==='walkthrough';
    let dwellStart=0,lastKey='',consecutive=0,longestGenericDwell=0;
    for(const shot of shots) {
      const walk=shot.walkthrough,m=walk?.pageMotion;
      if(!pageShot(shot)){lastKey='';consecutive=0;continue;}
      consecutive++;
      const key=JSON.stringify([walk?.location.pageId,walk?.location.sectionId,walk?.location.selector,walk?.location.scrollY,walk?.location.offsetY]);
      // A navigation or drift resets dwell only while moving; its frozen tail counts.
      if(m){dwellStart=shot.start+m.holdIn+m.motionDuration;lastKey=JSON.stringify([walk?.location.pageId,walk?.location.sectionId,walk?.location.selector,m.endY,(walk?.location.offsetY||0)+m.endY-m.startY]);}
      else if(key!==lastKey || walk?.transition){dwellStart=shot.start+(walk?.transition?.duration||0);lastKey=key;}
      const dwell=activeTime(dwellStart,shot.start+shot.duration);longestGenericDwell=Math.max(longestGenericDwell,dwell);
      if(m && activeTime(shot.start+(walk?.transition?.duration||0),shot.start+m.holdIn)>4.8)add('generic-static-dwell','Generic page has a long unchanged arrival hold before motion during active narration',shot.id);
      if(dwell>4.8)add('generic-static-dwell',`${dwell.toFixed(1)}s unchanged generic page during active VO. Review relevant media, section reveal or slow scroll. ${shot.retention?.staticHoldReason||''}`,shot.id);
      if(consecutive===3)add('consecutive-generic-pages','Three consecutive contextual page shots; review whether existing product evidence would explain the narration better',shot.id);
    }
    for(const beat of transcript.segments.slice(1)) {
      const section=sections.find(s=>s.id===beat.sectionId || s.sceneId===beat.sceneId);if(!section || !visibleFeature.test(beat.text))continue;
      const available=assets.some(a=>productMedia(a,inventory) && a.sourceId===section.sourceId && localAsset(a,section,inventory) && featureMediaMatch(beat.text,a)) || !!overviewEvidence(beat,section,inventory);
      const evidence=shots.filter(s=>s.segmentId===beat.id && !pageShot(s));
      if(available && beat.end-beat.start>=4.8 && !evidence.length)add('feature-without-evidence','Visible feature narration stays on prose despite relevant source product media',shots.find(s=>s.segmentId===beat.id)?.id);
      for(const shot of evidence)if(shot.support) {
        const group=shots.filter(s=>s.support?.id===shot.support!.id);
        if(group[0].start>shot.support.transcriptStart+.05 || group.at(-1)!.start+group.at(-1)!.duration<shot.support.transcriptEnd-.05)add('brief-product-evidence','Product media disappears before its feature explanation finishes',shot.id);
        const asset=assets.find(a=>a.id===shot.assetId);
        if(asset && shot.walkthrough?.role==='cutaway' && !localAsset(asset,section,inventory) && !(shot.support.visualRole==='product-context' && overviewEvidence(beat,section,inventory)?.id===asset.id))add('unrelated-retention-media','Media has no active section or supported overview association; variety does not override relevance',shot.id);
      }
    }
    metrics={genericPageDuration:shots.filter(pageShot).reduce((n,s)=>n+s.duration,0),productMediaDuration:shots.filter(s=>!pageShot(s) && assets.some(a=>a.id===s.assetId && productMedia(a,inventory))).reduce((n,s)=>n+s.duration,0),heroDuration:shots.filter(s=>s.walkthrough?.role==='ending').reduce((n,s)=>n+s.duration,0),longestGenericDwell};
    if(heroes.heroAsset) {
      const middleStart=transcript.duration/3,middleEnd=transcript.duration*2/3;
      if(!shots.some(s=>!pageShot(s) && s.start<middleEnd && s.start+s.duration>middleStart))add('midpoint-evidence','Middle third has no meaningful product evidence despite an available hero; review source-backed feature coverage');
      const generic=shots.filter(pageShot).reduce((n,s)=>n+s.duration,0),evidence=transcript.duration-generic;
      // Advisory relative balance, never a mandatory page/media percentage.
      if(generic>evidence*2)add('generic-page-dominance',`${generic.toFixed(1)}s of ${transcript.duration.toFixed(1)}s uses generic page context despite source product media; inspect whether features get enough evidence`);
      const ending=shots.at(-1),takeaway=transcript.segments.at(-1);
      if(ending && takeaway && finalTakeaway(takeaway)) {
        if(pageShot(ending) || ending.assetId!==heroes.heroAsset && ending.assetId!==heroes.secondaryHeroAsset)add('weak-ending','Final takeaway ends on generic context or a weaker asset despite an available product hero',ending.id);
        else if(ending.duration<3)add('short-hero-ending','Final hero has less than three seconds to register; extend when the real narration permits',ending.id);
      }
    }
  }
  return {retention:metrics,passed:!issues.some(i=>i.severity==='error'),score:Math.max(0,100-issues.reduce((n,i)=>n+(i.severity==='error'?20:3),0)),scrollDuration:shots.reduce((n,s)=>n+(s.walkthrough?.transition?.duration||0),0),issues};
}
