import {z} from 'zod';
import type {Inventory,Research,StoryOutline} from '../lib/types';
import {pagesFor} from './document-map';
import {modelEnabled,modelJson} from '../lib/llm';
import {promotionalPolicy,codeVisualsAllowed} from './content-policy';
import {addOverviewEvidence,productMedia,capabilityOverview} from './script-brief';
import {ensureEditorial,isCore} from './editorial';

export const storyRevision=5;
const normal=(s:string)=>s.replace(/\s+/g,' ').trim().toLowerCase();
export function sectionClaims(research:Research,inventory:Inventory) {
 return pagesFor(inventory).flatMap(p=>p.sections).map(section=>({section,claims:research.claims.filter(c=>(!c.id.startsWith('script-overview-')||capabilityOverview(c.quote)) && c.sourceId===section.sourceId && normal(section.text).includes(normal(c.quote)))}));
}
export async function buildOutline(research:Research,inventory:Inventory,feedback?:string):Promise<StoryOutline> {
 addOverviewEvidence(research,inventory);
 const editorial=await ensureEditorial(research,inventory),notes=[...editorial.notes],promotional=!codeVisualsAllowed(inventory.contentMode);
 const rankings=new Map(editorial.claims.map(c=>[c.claimId,c]));
 const proofIds=new Set(editorial.strongestProof.flatMap(p=>p.claimIds));
 let candidates=sectionClaims(research,inventory).filter(v=>v.claims.length && v.section.sceneId);
 if(promotional)candidates=candidates.map(v=>({...v,claims:v.claims.filter(c=>{const rank=rankings.get(c.id);return rank && rank.thesisContribution>=3 && !['MINOR_FEATURE','TECHNICAL_TRIVIA'].includes(rank.category);})})).filter(v=>v.claims.length && (!/\b(command.line|terminal|installation|dependencies|development)\b/i.test(v.section.heading) || v.claims.some(c=>isCore(rankings.get(c.id)!.category))));
 if(!candidates.length)throw new Error('No editorial evidence belongs to mapped document sections. Refresh research before scripting.');
 const identityIds=new Set(editorial.productIdentity.claimIds);
 const intro=candidates.find(v=>v.claims.some(c=>identityIds.has(c.id)))||candidates[0];
 const caveatIds=new Set(editorial.importantCaveat?.claimIds||[]);
 const caveatScore=(v:typeof candidates[number])=>Math.max(...v.claims.filter(c=>rankings.get(c.id)?.category==='CAVEAT').map(c=>rankings.get(c.id)!.thesisContribution));
 const ending=candidates.filter(v=>v!==intro && v.claims.some(c=>rankings.get(c.id)?.category==='CAVEAT'))
  .sort((a,b)=>caveatScore(b)-caveatScore(a)||Number(b.claims.some(c=>caveatIds.has(c.id)))-Number(a.claims.some(c=>caveatIds.has(c.id))))[0];
 const core=(v:typeof candidates[number])=>v.claims.some(c=>isCore(rankings.get(c.id)!.category));
 // Editorial scores contain NO visual properties. Media is chosen only after visits.
 const importance=(v:typeof candidates[number])=>Math.max(...v.claims.map(c=>rankings.get(c.id)!.thesisContribution+(proofIds.has(c.id)?2:0)));
 const ranked=candidates.filter(v=>v!==intro && v!==ending).sort((a,b)=>importance(b)-importance(a)||candidates.indexOf(a)-candidates.indexOf(b));
 const proof=ranked.filter(core).slice(0,3);
 const differentiator=ranked.find(v=>!core(v) && v.claims.some(c=>rankings.get(c.id)!.category==='DIFFERENTIATOR'));
 let selected=promotional?[intro,...proof,...(proof.length<3 && differentiator?[differentiator]:[]),...(ending?[ending]:[])]:candidates;
 if(modelEnabled() && promotional) {
  try {
   const result=await modelJson('Select the strongest thesis-led story, usually 3–5 visits; fewer when evidence is sparse. State identity/thesis, PROVE the core promise with the best evidence, optionally deepen it with a genuinely important secondary differentiator, then caveat/takeaway. Each major beat must prove/deepen the thesis or give the caveat. No mandatory surprise or differentiator. Compare each chosen beat against omitted CORE_PROOF; an ordinary feature cannot displace better evidence. Minor details must not earn runtime through media availability. Consider explicit source pillars together. Apply revisionFeedback relative to this editorial brief; de-emphasizing a secondary capability must be possible. Preserve source order and local claim ownership. Select section IDs, never invent evidence.',{editorial,revisionFeedback:feedback,candidates:candidates.map(v=>({sectionId:v.section.id,heading:v.section.heading,claims:v.claims.map(c=>({...c,editorial:rankings.get(c.id)})),editorialImportance:importance(v)}))},z.object({sectionIds:z.array(z.string()).min(1).max(5)}),[],'navigation');
   if(result.sectionIds.some(id=>!candidates.some(v=>v.section.id===id)))throw new Error('Planner selected an ineligible section');
   const ids=new Set(result.sectionIds);ids.add(intro.section.id);if(ending)ids.add(ending.section.id);
   selected=candidates.filter(v=>ids.has(v.section.id));
  }catch(error){notes.push(`Outline used editorial fallback: ${(error as Error).message}`);}
 }
 if(promotional) {
  // A model cannot spend all the body on secondary details while omitting core proof.
  // Repair that choice before the writer sees the outline. No forced differentiator.
  for(const omitted of proof) {
   if(selected.includes(omitted))continue;
   const weak=selected.filter(v=>v!==intro && v!==ending).sort((a,b)=>importance(a)-importance(b)).find(v=>!core(v));
   if(weak && importance(weak)<importance(omitted)) {selected=selected.filter(v=>v!==weak);selected.push(omitted);notes.push(`Editorial-importance check replaced ${weak.section.heading} with omitted core proof ${omitted.section.heading}.`);}
  }
  // Distinct core pillars matter more than repeating the same kind of proof.
  // Evaluate the body independently of the introductory identity/capability list.
  const groups=(v:typeof candidates[number])=>editorial.coreCapabilities.flatMap((p,i)=>v.claims.some(c=>p.claimIds.includes(c.id))?[i]:[]);
  const coverage=(visits:typeof candidates)=>new Set(visits.filter(v=>v!==intro && v!==ending && core(v)).flatMap(groups));
  for(const omitted of ranked.filter(core)) {
   if(selected.includes(omitted))continue;
   const covered=coverage(selected);
   if(!groups(omitted).some(g=>!covered.has(g)))continue;
   const redundant=selected.filter(v=>v!==intro && v!==ending && core(v) && groups(v).length)
    .sort((a,b)=>importance(a)-importance(b)||candidates.indexOf(b)-candidates.indexOf(a))
    .find(v=>importance(v)<=importance(omitted) && [...covered].every(g=>coverage(selected.filter(s=>s!==v)).has(g)));
   if(redundant){selected=selected.filter(v=>v!==redundant);selected.push(omitted);notes.push(`Editorial-importance check replaced repeated ${redundant.section.heading} proof with omitted core pillar ${omitted.section.heading}.`);}
  }
  if(!selected.some(v=>v!==intro && core(v)) && proof[0]){selected.push(proof[0]);notes.push('Restored core proof so the thesis survives beyond the opening.');}
  const anchors=[intro,...(ending?[ending]:[])];
  selected=[...anchors,...selected.filter(v=>!anchors.includes(v)).sort((a,b)=>Number(core(b))-Number(core(a))||importance(b)-importance(a)||candidates.indexOf(a)-candidates.indexOf(b)).slice(0,5-anchors.length)];
  notes.push(promotionalPolicy,'Story importance selected visits before media. Omitted evidence was compared against selected secondary details.');
 }
 selected=candidates.filter(v=>selected.includes(v));
 return {revision:storyRevision,editorial,notes,visits:selected.map((v,i)=>{
  const role=i===0?'introduction':v===ending?'caveat':core(v)?(i===1?'core-experience':'proof'):'differentiator';
  return {id:`visit-${i+1}`,sectionId:v.section.id,sceneId:v.section.sceneId!,claimIds:v.claims.sort((a,b)=>(rankings.get(b.id)?.thesisContribution||0)-(rankings.get(a.id)?.thesisContribution||0)).map(c=>c.id),purpose:v.section.heading,reason:`${role}: thesis contribution ${importance(v)}; ${productMedia(inventory,v.section.id).length?'local product media can illustrate this selected beat':'source section provides contextual visual support'}`,storyRole:role};
 })};
}
