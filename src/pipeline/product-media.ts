import type { Inventory, PageSection, Shot, TimedSegment, VisualAsset } from '../lib/types';
import { assetsFor, relevance } from './visual-utils';
import { pagesFor, entryPageFor } from './document-map';
import { eligibleVisual } from './content-policy';

export const visibleFeature = /\b(layers?|masks?|curves|vibrance|adjustments?|editing|editor|workflow|brushes|vectors?|canvas|panels?|psd|photoshop|rendering|modeling|timeline|dashboard)\b/i;
const mediaTypes=['image','gif','video','demo'];
const genericTerms=/\b(editor|editing|edits?|workflow|product|screenshot|app|native|software|image|panel|panels|interface|controls|ui)\b/gi;
export function featureMediaMatch(text:string,asset:VisualAsset) {
  const description=`${asset.description} ${asset.features.join(' ')}`;
  return relevance(text.replace(genericTerms,''),description.replace(genericTerms,''))>0;
}
export function productMedia(asset:VisualAsset,inventory:Inventory) {
  return eligibleVisual(asset,inventory.contentMode) && mediaTypes.includes(asset.type) && asset.confidence>=.5 && asset.quality>=.5 && asset.width>=480 && asset.height>=240 && !!(asset.localPath || asset.type==='demo') && !/\b(badge|logo|avatar|star history)\b/i.test(asset.description) && visibleFeature.test(`${asset.description} ${asset.features.join(' ')}`);
}
export function selectHeroAssets(inventory:Inventory) {
  const entry=entryPageFor(inventory),sourceId=entry?.sourceId;
  const candidates=assetsFor(inventory).filter(a=>productMedia(a,inventory) && (!sourceId || a.sourceId===sourceId));
  const score=(a:VisualAsset)=>a.quality*3+a.confidence+(a.sectionId===entry?.sections[0]?.id?2:0)+Math.min(2,(a.description.match(/\b(layers?|masks?|brushes|type|vectors?|canvas|panels?|editor|workflow)\b/gi)||[]).length*.2);
  candidates.sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id));
  return {heroAsset:candidates[0]?.id,secondaryHeroAsset:candidates[1]?.id};
}
// Local feature screenshots are preferred by the walkthrough. A broader overview
// is permitted only for the same source's visible capability, never random variety.
export function overviewEvidence(beat:TimedSegment,section:PageSection,inventory:Inventory) {
  if(!visibleFeature.test(beat.text) || /\b(install|installation|run the command|configuration|code example)\b/i.test(beat.text))return;
  const page=pagesFor(inventory).find(p=>p.sections.some(s=>s.id===section.id));
  return assetsFor(inventory).filter(a=>productMedia(a,inventory) && a.sourceId===section.sourceId && a.sectionId===page?.sections[0]?.id && featureMediaMatch(beat.text,a)).sort((a,b)=>b.quality-a.quality)[0];
}
export function finalTakeaway(beat:TimedSegment) {
  // A specific instruction to install or inspect code must remain on that context.
  const sentences=beat.text.match(/[^.!?]+[.!?]?(?:\s+|$)/g)?.map(s=>s.trim()).filter(Boolean)||[beat.text];
  const last=sentences.at(-1)!;
  if(/\b(install|installation|run the command|npm|cargo|pip|clone the|configuration|code example)\b/i.test(last) || !visibleFeature.test(last))return;
  if(sentences.length>1 && /\b(appeal|takeaway|draw|worth|watch|try|overall|in short|open.source|offline|full|complete|product)\b/i.test(last))return last;
  if(/^(?:For |On |When |From there|Next |To )/i.test(last))return;
  if(/\b(alpha|beta|not ready|caveat|limitations?)\b/i.test(last) || !/\b(appeal|takeaway|draw|worth|watch|try|overall|open.source|offline|full|complete|product)\b/i.test(last))return;
  return last;
}
export function planMediaMotion(asset:VisualAsset,duration:number,role:'evidence'|'hero',text:string):Shot['mediaMotion'] {
  if(asset.type!=='image' || duration<5 || !visibleFeature.test(text))return;
  const holdIn=1.5,holdOut=.8;
  return {kind:'attention',holdIn,motionDuration:duration-holdIn-holdOut,holdOut,maxZoom:role==='hero'?1.025:1.04,focus:asset.focus,reason:asset.focus?'Gently direct attention to the source-backed UI region while preserving the full product.':'Keep the full product recognizable during a sustained inspection; establish wide, gently approach, then settle.'};
}
