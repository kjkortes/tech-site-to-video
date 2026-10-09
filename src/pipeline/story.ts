import {z} from 'zod';
import type {Inventory,Research,StoryOutline} from '../lib/types';
import {pagesFor} from './document-map';
import {modelEnabled,modelJson} from '../lib/llm';
import {promotionalPolicy,codeVisualsAllowed} from './content-policy';
import {addOverviewEvidence,productMedia,capabilityOverview} from './script-brief';
import {ensureEditorial,isCore} from './editorial';
import {promotionalClaim,audienceBeatScore,audienceValue,numericCapabilityProof} from './audience-value';

export const storyRevision=7;
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
 if(promotional)candidates=candidates.map(v=>({...v,claims:v.claims.filter(c=>{const rank=rankings.get(c.id);return rank && rank.thesisContribution>=3 && promotionalClaim(rank);})})).filter(v=>v.claims.length && (!/\b(command.line|terminal|installation|dependencies|development)\b/i.test(v.section.heading) || v.claims.some(c=>isCore(rankings.get(c.id)!.category))));
 if(!candidates.length)throw new Error('No editorial evidence belongs to mapped document sections. Refresh research before scripting.');
 const identityIds=new Set(editorial.productIdentity.claimIds);
 const intro=candidates.find(v=>v.claims.some(c=>identityIds.has(c.id)))||candidates[0];
 // Give source-backed breadth its own visit, even when research bundled it
 // into identity. Two visits on the same section preserve spatial continuity.
 const overviewClaims=promotional?intro.claims.filter(c=>!identityIds.has(c.id)&&rankings.get(c.id)?.category==='CORE_EXPERIENCE'&&rankings.get(c.id)?.experienceScope==='broad'):[];
 const introExperience=overviewClaims.length?{section:intro.section,claims:overviewClaims}:undefined;
 if(introExperience){intro.claims=intro.claims.filter(c=>!overviewClaims.includes(c));candidates.splice(candidates.indexOf(intro)+1,0,introExperience);}
 const experience=introExperience||candidates.find(v=>v!==intro&&v.claims.some(c=>rankings.get(c.id)?.category==='CORE_EXPERIENCE'&&rankings.get(c.id)?.experienceScope==='broad'));
 const caveatIds=new Set(editorial.importantCaveat?.claimIds||[]);
 const caveatScore=(id:string)=>{const rank=rankings.get(id)!;return audienceValue(rank)+(rank.audience.caveatImpact==='readiness'?2:0);};
 const mainCaveat=candidates.flatMap(v=>v.claims.filter(c=>rankings.get(c.id)?.category==='CAVEAT').map(c=>({candidate:v,claim:c})))
  .sort((a,b)=>caveatScore(b.claim.id)-caveatScore(a.claim.id)||Number(caveatIds.has(b.claim.id))-Number(caveatIds.has(a.claim.id)))[0];
 const ending=mainCaveat?.candidate!==intro?mainCaveat?.candidate:undefined;
 const core=(v:typeof candidates[number])=>v.claims.some(c=>isCore(rankings.get(c.id)!.category));
 // Visual demonstrability matters, but attractive media cannot rescue a weak fact.
 // Actual assets are still selected only after the story earns its visits.
 const importance=(v:typeof candidates[number])=>Math.max(...v.claims.map(c=>audienceBeatScore(rankings.get(c.id)!,proofIds.has(c.id))));
 const essentialCaveat=(id:string)=>{const rank=rankings.get(id)!;return rank.category==='CAVEAT'&&rank.audience.caveatImpact==='material'&&rank.audience.essentialForAudience;};
 if(promotional) {
  // Keep one practical caveat, including when several caveats share a proof section.
  for(const candidate of candidates)candidate.claims=candidate.claims.filter(c=>rankings.get(c.id)?.category!=='CAVEAT'||c.id===mainCaveat?.claim.id||essentialCaveat(c.id));
  candidates=candidates.filter(v=>v.claims.length);
  if(experience){const contextIndex=candidates.indexOf(experience);candidates=candidates.filter((v,i)=>v===intro||v===ending||v===experience||i>contextIndex||v.claims.some(c=>essentialCaveat(c.id)));}
 }
 const ranked=candidates.filter(v=>v!==intro && v!==ending && v!==experience).sort((a,b)=>importance(b)-importance(a)||candidates.indexOf(a)-candidates.indexOf(b));
 const essentialCaveatVisits=promotional?candidates.filter(v=>v.claims.some(c=>essentialCaveat(c.id))):[];
 const coreRanked=ranked.filter(core);
 const hardProof=coreRanked.find(v=>v.claims.some(c=>rankings.get(c.id)?.category==='CORE_PROOF'));
 const usefulDepth=coreRanked.find(v=>v!==hardProof&&v.claims.some(c=>rankings.get(c.id)?.category==='CORE_EXPERIENCE'));
 const proof=[...new Set([...(hardProof?[hardProof]:[]),...(usefulDepth?[usefulDepth]:[]),...coreRanked])].slice(0,experience?2:3);
 const differentiator=ranked.find(v=>!core(v) && v.claims.some(c=>rankings.get(c.id)!.category==='DIFFERENTIATOR'));
 let selected=promotional?[intro,...(experience?[experience]:[]),...proof,...(proof.length<(experience?2:3) && differentiator?[differentiator]:[]),...(ending?[ending]:[]),...essentialCaveatVisits]:candidates;
 if(modelEnabled() && promotional) {
  try {
   const result=await modelJson('Select the strongest thesis-led story for a GENERAL TECH/SOFTWARE audience, usually 3–5 visits; fewer when evidence is sparse. State identity/thesis, establish BROAD CORE EXPERIENCE (what users can do), THEN use strong proof as a payoff, optionally deepen one capability or add a useful differentiator, then one practical caveat/takeaway. Reserve broad experience even when it shares the identity section. Numeric specificity cannot replace breadth or force a metric immediately after identity. CORE_EXPERIENCE and CORE_PROOF are distinct roles. Project importance alone is insufficient. Rank thesis relevance × audience value × visual demonstrability, subtract complexity/runtime cost and redundant coverage. Every beat must earn 3–6 seconds: would a normal viewer care, understand it, see it and change their view of the product? Engineering validation does not earn a beat merely because it is unique or serious. No mandatory surprise or differentiator. Compare each chosen beat against omitted audience-valuable CORE_PROOF. Attractive media cannot rescue a weak fact. Apply revisionFeedback relative to this editorial brief. Preserve source order and local claim ownership. Select section IDs from eligible candidates, never invent evidence.',{audience:'general tech/software',mode:'promotional',editorial,revisionFeedback:feedback,candidates:candidates.map(v=>({sectionId:v.section.id,heading:v.section.heading,claims:v.claims.map(c=>({...c,editorial:rankings.get(c.id),audienceValue:audienceValue(rankings.get(c.id)!)})),editorialImportance:importance(v)}))},z.object({sectionIds:z.array(z.string()).min(1).max(5)}),[],'navigation');
   if(result.sectionIds.some(id=>!candidates.some(v=>v.section.id===id)))throw new Error('Planner selected an ineligible section');
   const ids=new Set(result.sectionIds);ids.add(intro.section.id);if(experience)ids.add(experience.section.id);if(ending)ids.add(ending.section.id);for(const visit of essentialCaveatVisits)ids.add(visit.section.id);
   selected=candidates.filter(v=>ids.has(v.section.id));
  }catch(error){notes.push(`Outline used editorial fallback: ${(error as Error).message}`);}
 }
 if(promotional) {
  // A model cannot spend all the body on secondary details while omitting core proof.
  // Repair that choice before the writer sees the outline. No forced differentiator.
  for(const omitted of proof) {
   if(selected.includes(omitted))continue;
   const weak=selected.filter(v=>v!==intro && v!==ending && v!==experience).sort((a,b)=>importance(a)-importance(b)).find(v=>!core(v));
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
   const redundant=selected.filter(v=>v!==intro && v!==ending && v!==experience && !v.claims.some(c=>numericCapabilityProof(c.quote,rankings.get(c.id)!)) && core(v) && groups(v).length)
    .sort((a,b)=>candidates.indexOf(b)-candidates.indexOf(a))
    .find(v=>[...covered].every(g=>coverage(selected.filter(s=>s!==v)).has(g)));
   if(redundant){selected=selected.filter(v=>v!==redundant);selected.push(omitted);notes.push(`Editorial-importance check replaced repeated ${redundant.section.heading} proof with omitted core pillar ${omitted.section.heading}.`);}
  }
  if(!selected.some(v=>v!==intro && core(v)) && proof[0]){selected.push(proof[0]);notes.push('Restored core proof so the thesis survives beyond the opening.');}
  const anchors=[...new Set([intro,...(experience?[experience]:[]),...(hardProof&&selected.includes(hardProof)?[hardProof]:[]),...(ending?[ending]:[]),...essentialCaveatVisits])];
  selected=[...anchors,...selected.filter(v=>!anchors.includes(v)).sort((a,b)=>Number(core(b))-Number(core(a))||importance(b)-importance(a)||candidates.indexOf(a)-candidates.indexOf(b)).slice(0,5-anchors.length)];
  notes.push(promotionalPolicy,'Thesis relevance × audience value × visual demonstrability selected visits before media; complexity/runtime costs and redundant coverage reduce priority. Internal validation and technical micro-caveats remain in research.');
  if(experience)notes.push('Breadth before proof: reserved a grounded core-experience visit; numeric evidence supports that context rather than determining the story. Earlier proof/depth without experience context was omitted to preserve source order.');
 }
 selected=candidates.filter(v=>selected.includes(v));
 const preferredProofClaimIds=promotional?selected.flatMap(v=>v.claims).filter(c=>numericCapabilityProof(c.quote,rankings.get(c.id)!))
  .sort((a,b)=>audienceBeatScore(rankings.get(b.id)!)-audienceBeatScore(rankings.get(a.id)!)).slice(0,1).map(c=>c.id):[];
 return {revision:storyRevision,editorial,notes,preferredProofClaimIds,visits:selected.map((v,i)=>{
  const role=i===0?'introduction':v===ending||essentialCaveatVisits.includes(v)?'caveat':!promotional&&v.claims.some(c=>rankings.get(c.id)!.audience.evidenceKind!=='user-capability')?'technical':v===experience?'core-experience':v.claims.some(c=>rankings.get(c.id)?.category==='CORE_PROOF')?'proof':core(v)?(experience?'depth':'core-experience'):'differentiator';
  return {id:`visit-${i+1}`,sectionId:v.section.id,sceneId:v.section.sceneId!,claimIds:v.claims.sort((a,b)=>audienceBeatScore(rankings.get(b.id)!)-audienceBeatScore(rankings.get(a.id)!)).map(c=>c.id),purpose:v.section.heading,reason:`${role}: audience-weighted importance ${importance(v).toFixed(2)}; ${productMedia(inventory,v.section.id).length?'local product media can illustrate this selected beat':'source section provides contextual visual support'}`,storyRole:role};
 })};
}
