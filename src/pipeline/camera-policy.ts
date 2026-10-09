import type { DiversityReport, Inventory, Shot, SourceType, Transcript } from '../lib/types';
import { assetsFor } from './visual-utils';
import { pagesFor, entryPageFor } from './document-map';
import { cameraGeometry, cameraMode, maximumDetailZoom } from './framing';

export function sourceTypeFor(inventory:Inventory):SourceType {
  if(inventory.sourceType)return inventory.sourceType;
  const url=new URL(inventory.sourceUrl||pagesFor(inventory)[0]?.url||inventory.scenes[0].url);
  if(url.hostname==='github.com')return 'githubRepo';
  return /(^|\/)(docs?|documentation)(\/|$)/i.test(url.pathname) || /^docs\./i.test(url.hostname)?'documentation':'website';
}
export function cameraSummary(shots:Shot[],inventory:Inventory) {
  const assets=assetsFor(inventory),total=shots.reduce((n,s)=>n+s.duration,0);
  const views=shots.map(s=>{const asset=assets.find(a=>a.id===s.assetId);return {shotId:s.id,duration:s.duration,...cameraGeometry(s,asset)}});
  const detailDuration=views.filter(v=>v.mode==='detail').reduce((n,v)=>n+v.duration,0);
  const pageDuration=views.filter(v=>v.mode==='walkthrough').reduce((n,v)=>n+v.duration,0);
  return {total,pageDuration,detailDuration,contextualRatio:total?(total-detailDuration)/total:0,pageRatio:total?pageDuration/total:0,detailRatio:total?detailDuration/total:0,views};
}
export function validateCameraPlan(shots:Shot[],inventory:Inventory,transcript:Transcript):DiversityReport {
  const issues:DiversityReport['issues']=[],assets=assetsFor(inventory),pages=pagesFor(inventory),first=shots[0],entry=entryPageFor(inventory,pages.find(p=>p.sourceId===inventory.scenes.find(s=>s.id===transcript.segments[0]?.sceneId)?.sourceId));
  const add=(code:string,detail:string,shotId?:string,severity:'error'|'warning'='error')=>issues.push({code,detail,shotId,severity});
  const type=sourceTypeFor(inventory),firstAsset=assets.find(a=>a.id===first?.assetId);
  if(!first || cameraMode(first)!=='walkthrough' || !['walkthrough','establish'].includes(first.type||'') || firstAsset?.type!=='section' || !!first.walkthrough?.transition || first.url.split('#')[0]!==entry?.url.split('#')[0] || first.walkthrough && (first.walkthrough.location.sectionId!==entry?.sections[0]?.id || type==='githubRepo' && first.walkthrough.location.selector!==entry?.sections[0]?.selector))
    add('source-intro',`First shot must establish the ${type==='githubRepo'?'repository / README beginning':type==='documentation'?'documentation landing / title':'homepage / landing hero'} at normal page scale`,first?.id);
  const summary=cameraSummary(shots,inventory);
  for(let i=0;i<shots.length;i++) {
    const shot=shots[i],mode=cameraMode(shot),g=summary.views[i],previous=shots[i-1],next=shots[i+1];
    const requested=shot.camera?.maxZoom??1;
    if(shot.mediaMotion) {
      const m=shot.mediaMotion,asset=assets.find(a=>a.id===shot.assetId);
      if(mode!=='media' || asset?.type!=='image' || !shot.support || !m.reason || m.kind!=='attention' || ![m.holdIn,m.motionDuration,m.holdOut,m.maxZoom].every(Number.isFinite) || m.maxZoom<1 || m.maxZoom>1.05 || m.holdIn<1.5 || m.holdOut<.6 || m.motionDuration<=0 || Math.abs(m.holdIn+m.motionDuration+m.holdOut-shot.duration)>.025)
        add('media-attention','Product attention motion must establish wide, remain at or below 1.05x, and settle inside the supported phrase',shot.id);
      if(m.focus && (![m.focus.x,m.focus.y,m.focus.width,m.focus.height].every(Number.isFinite) || m.focus.x<0 || m.focus.y<0 || m.focus.width<=0 || m.focus.height<=0 || m.focus.x+m.focus.width>1 || m.focus.y+m.focus.height>1))add('media-attention-focus','Product attention focus must be a measured source region inside the full image',shot.id);
      if(g.visibleSourceArea<.94)add('media-attention-crop','Subtle product motion must retain at least 94% of its source',shot.id);
    }
    if(mode!=='detail' && (requested>1 || shot.camera?.focus || shot.motion && shot.motion!=='hold'))add('default-zoom','Walkthrough and media must remain at normal scale without automatic camera motion',shot.id);
    if(mode==='walkthrough' && (shot.focus || shot.highlight || shot.framing==='detail'))add('page-crop','Normal page views cannot crop to individual text or controls',shot.id);
    if(mode==='detail') {
      const beat=transcript.segments.find(b=>b.id===shot.segmentId);
      if(!shot.camera?.reason || !shot.camera.detailText || !beat?.text.includes(shot.camera.detailText) || !g.region)add('detail-reason','Detail requires an exact narrated feature, reason and source focal region',shot.id);
      if(requested>maximumDetailZoom || requested<1)add('zoom-limit',`Detail exceeds the configured ${maximumDetailZoom}x maximum`,shot.id);
      if(!previous || cameraMode(previous)!=='media' || previous.assetId!==shot.assetId || previous.duration<1.5)add('detail-establish','Detail must immediately follow a readable wide view of the same media',shot.id);
      if(!next || !(cameraMode(next)==='media' && next.assetId===shot.assetId || cameraMode(next)==='walkthrough' && next.walkthrough?.location.sectionId===shot.walkthrough?.returnTarget?.sectionId))add('detail-return','Detail must return to the full source or the same page context',shot.id);
      if(shot.duration>4.5)add('detail-temporary','Detail is a temporary inspection, not a whole narration beat',shot.id);
    }
    if(g.visibleSourceArea<.5)add('visible-source-area','Less than half the source is visible; reframe and verify an established, narrated temporary detail',shot.id);
  }
  if(summary.detailRatio>.35)add('zoom-ratio',`${(summary.detailRatio*100).toFixed(0)}% of runtime is detail; most runtime must retain context`);
  if(summary.detailRatio>.2 && summary.detailRatio<=.35)add('zoom-ratio-review','Review detail density and preserve the source walkthrough',undefined,'warning');
  return {passed:!issues.some(i=>i.severity==='error'),score:Math.max(0,100-issues.reduce((n,i)=>n+(i.severity==='error'?20:2),0)),scrollDuration:0,issues};
}
