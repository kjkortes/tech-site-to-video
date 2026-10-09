import type { DiversityReport, Inventory, PageMotion, PageSection, Shot, Transcript, WalkLocation } from '../lib/types';
import { pagesFor } from './document-map';
import { verticalSafeArea } from './safe-area';
import { videoLayout } from './video-layout';

function needsInspection(section:PageSection) {
  const height=section.endY-section.scrollY;
  return height>0 && height<=verticalSafeArea.focal.height && section.text.length>1400 && section.text.length/height>2.5;
}

// Document coordinates are measured at native CSS scale, never supplied by the model.
export function scrollCorridor(section:PageSection,startY:number) {
  const height=section.endY-section.scrollY;
  // Tall sections must not bring the next topic into view. Compact sections may
  // reframe their lower evidence, but retain at least 70% (and 320px) of context.
  const retained=Math.min(videoLayout.viewport.height,Math.max(320,height*.7));
  const minY=section.scrollY;
  const maxY=Math.max(minY,Math.min(section.endY-retained,minY+Math.min(videoLayout.viewport.height*.28,verticalSafeArea.focal.height*.45)));
  return {minY,maxY,startY:Math.max(minY,Math.min(maxY,startY)),sectionEndY:section.endY};
}
export function planPageMotion(section:PageSection,location:WalkLocation,duration:number,navigation=0,budget=Infinity):PageMotion|undefined {
  const c=scrollCorridor(section,location.scrollY),available=c.maxY-location.scrollY;
  if(needsInspection(section) || duration<3.5 || available<65 || location.scrollY<c.minY || location.scrollY>c.maxY)return;
  const holdIn=navigation+.65,minimumHoldOut=.6;
  // Leave real stillness at both ends, and reserve pauses in unusually long beats.
  const motionDuration=Math.min(duration-holdIn-minimumHoldOut,8,budget);
  if(motionDuration<1.6)return;
  const easeDuration=Math.min(.45,motionDuration*.18);
  const density=section.text.length/Math.max(1,section.endY-section.scrollY);
  const speed=Math.max(30,Math.min(65,60-density*8));
  const idealEndY=location.scrollY+speed*(motionDuration-easeDuration);
  const endY=Math.min(c.maxY,idealEndY);
  // Small corridors deserve a gentle reframe, not a fast scroll then a long freeze.
  if((endY-location.scrollY)/(motionDuration-easeDuration)<12)return;
  return {kind:'slow-scroll',...c,startY:location.scrollY,idealEndY,endY,holdIn,motionDuration,holdOut:duration-holdIn-motionDuration,easeDuration,reason:'Reveal supporting content within the active section, then settle above the fixed caption zone.'};
}
// Integral of a trapezoidal velocity curve: cosine acceleration/deceleration,
// exactly linear middle. Zero velocity at both ends; max speed = distance/(D-E).
export function pageMotionY(m:PageMotion,time:number) {
  const t=Math.max(0,Math.min(m.motionDuration,time-m.holdIn)),e=m.easeDuration,d=m.motionDuration;
  let travel:number;
  if(t<e)travel=t/2-e*Math.sin(Math.PI*t/e)/(2*Math.PI);
  else if(t>d-e){const remaining=d-t;travel=d-e-(remaining/2-e*Math.sin(Math.PI*remaining/e)/(2*Math.PI));}
  else travel=t-e/2;
  return m.startY+(m.endY-m.startY)*travel/(d-e);
}
export function exitLocation(shot:Shot):WalkLocation|undefined {
  const location=shot.walkthrough?.location,m=shot.walkthrough?.pageMotion;
  return location && m?{...location,scrollY:m.endY,offsetY:(location.offsetY||0)+m.endY-m.startY}:location;
}
export function validatePageMotion(shots:Shot[],inventory:Inventory,transcript:Transcript):DiversityReport {
  const issues:DiversityReport['issues']=[],sections=pagesFor(inventory).flatMap(p=>p.sections);
  let moving=0,longRun=0,dwell=0,lastKey='';
  const add=(code:string,detail:string,shotId?:string,severity:'error'|'warning'='warning')=>issues.push({code,detail,shotId,severity});
  const keyFor=(location:WalkLocation)=>JSON.stringify([location.pageId,location.sectionId,location.scrollY,location.offsetY||0]);
  const hasRoom=(section:PageSection,location:WalkLocation)=>!needsInspection(section) && location.scrollY>=section.scrollY && scrollCorridor(section,location.scrollY).maxY-location.scrollY>=65;
  for(const shot of shots) {
    const walk=shot.walkthrough,m=walk?.pageMotion,section=sections.find(s=>s.id===walk?.location.sectionId);
    const page=shot.type==='walkthrough' && shot.cameraMode==='walkthrough' && walk?.role==='context';
    const active=transcript.segments.some(b=>b.start<shot.start+shot.duration && b.end>shot.start);
    const ending=shot.segmentId===transcript.segments.at(-1)?.id && transcript.segments.length>1;
    if(m) {
      if(!page || !section)add('page-motion-source','Slow scroll is allowed only on contextual document footage',shot.id,'error');
      const values=[m.startY,m.endY,m.idealEndY,m.minY,m.maxY,m.sectionEndY,m.holdIn,m.motionDuration,m.holdOut,m.easeDuration];
      const c=section && scrollCorridor(section,m.startY);
      if(!values.every(Number.isFinite) || m.endY<=m.startY || m.startY<m.minY || m.endY>m.maxY+.01 || !c || m.minY<c.minY-.01 || m.maxY>c.maxY+.01 || Math.abs(m.startY-(walk?.location.scrollY??NaN))>.01 || Math.abs(m.sectionEndY-(section?.endY??NaN))>.01)
        add('scroll-corridor','Page movement exceeds the measured active section corridor',shot.id,'error');
      if(m.holdIn<(walk?.transition?.duration||0)+.5 || m.holdOut<.4 || m.motionDuration<=0 || m.easeDuration<=0 || m.easeDuration>m.motionDuration/2 || Math.abs(m.holdIn+m.motionDuration+m.holdOut-shot.duration)>.02)
        add('scroll-rhythm','Page movement must establish, ease, and settle inside its narration slot',shot.id,'error');
      const speed=(m.endY-m.startY)/(m.motionDuration-m.easeDuration);
      if(speed>80)add('scroll-speed','Page drift exceeds 80 CSS pixels per second',shot.id,'error');
      if(m.motionDuration>9)add('scroll-continuous','One continuous page drift exceeds nine seconds',shot.id);
      moving+=m.motionDuration;
      longRun=m.motionDuration>4?longRun+1:0;
      if(longRun>=3)add('consecutive-page-motion','Three long page drifts in succession; consider a readable media cutaway or still beat',shot.id);
      const exit=exitLocation(shot);
      dwell=m.holdOut;lastKey=exit?keyFor(exit):'';
      if(page && section && exit && active && !ending && dwell>4.8 && hasRoom(section,exit))add('static-dwell',`${dwell.toFixed(1)}s static tail after drift with further relevant room; review a cutaway or continued movement`,shot.id);
    } else {
      longRun=0;
      const key=page?keyFor(walk.location):'';
      dwell=key && key===lastKey?dwell+shot.duration:shot.duration;lastKey=key;
      if(page && section && active && !ending && dwell>4.8 && hasRoom(section,walk.location))add('static-dwell',`${dwell.toFixed(1)}s unchanged page during narration with relevant room to drift`,shot.id);
    }
    moving+=walk?.transition?.duration||0;
  }
  if(moving>transcript.duration*.7+.01)add('motion-budget','Page motion exceeds 70% of runtime; restore visual pauses',undefined,'error');
  else if(moving>transcript.duration*.6+.01)add('motion-budget-review','Page motion exceeds 60% of runtime; inspect the balance of movement and stillness');
  return {passed:!issues.some(i=>i.severity==='error'),score:Math.max(0,100-issues.reduce((n,i)=>n+(i.severity==='error'?20:3),0)),scrollDuration:moving,issues};
}
