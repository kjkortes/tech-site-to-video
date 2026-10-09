import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import type {Research,Inventory,StoryOutline,Script,VisualAsset} from '../lib/types';
import {jobDir} from '../lib/store';
import {run} from '../lib/process';
import {pagesFor} from './document-map';
import {codeVisualsAllowed} from './content-policy';
import {audienceValue,promotionalClaim} from './audience-value';
import {isCore} from './editorial';
import {capabilityOverview,experienceFacets} from './product-experience';
export {capabilityOverview} from './product-experience';

const normal=(text:string)=>text.replace(/\s+/g,' ').trim().toLowerCase();
export function productMedia(inventory:Inventory,sectionId:string) {
  return (inventory.assets||[]).filter(a=>a.sectionId===sectionId && ['image','gif','video','demo'].includes(a.type) && !/\b(?:star history|sponsor badge|translation status|contributors|download badge|build status)\b/i.test(a.description)).sort((a,b)=>b.quality*b.confidence-a.quality*a.confidence);
}
// Restore missing overview evidence from the ALREADY researched source, never
// from image inference or another network pass. Each addition is an exact quote.
export function addOverviewEvidence(research:Research,inventory:Inventory) {
  if(codeVisualsAllowed(inventory.contentMode))return [];
  const first=pagesFor(inventory)[0]?.sections.find(s=>s.sceneId);
  const source=research.sources.find(s=>s.id===first?.sourceId);
  if(!first || !source)return [];
  const existing=research.claims.filter(c=>c.id.startsWith('script-overview-')&&c.sourceId===source.id&&capabilityOverview(c.quote));
  if(existing.length>=2)return [];
  const additions:string[]=[];
  for(const sentence of source.text.split(/(?<=[.!?])\s+/)) {
    const quote=sentence.trim();
    if(!capabilityOverview(quote) || experienceFacets(quote).length<3 || !normal(first.text).includes(normal(quote)) || research.claims.some(c=>c.sourceId===source.id && normal(c.quote)===normal(quote)))continue;
    // Concise capability overviews are easily lost in the research claim budget.
    // Keep plain literal lists/descriptions, excluding links, badges and hype.
    let id=`script-overview-${additions.length+1}`;while(research.claims.some(c=>c.id===id))id+='a';
    research.claims.push({id,sourceId:source.id,text:quote,quote});additions.push(id);
    if(existing.length+additions.length===2)break;
  }
  return additions;
}
export function scriptBrief(research:Research,inventory:Inventory,outline:StoryOutline,feedback?:string,previous?:Script) {
  const sections=pagesFor(inventory).flatMap(p=>p.sections);
  const editorial=outline.editorial||research.editorial;
  const finalSource=inventory.scenes.find(s=>s.id===outline.visits.at(-1)?.sceneId)?.sourceId;
  const earlierIds=new Set(outline.visits.slice(0,-1).flatMap(v=>v.claimIds));
  return {
    product:research.title,mode:inventory.contentMode||'promotional',wordTarget:{idealMin:80,max:115,shorterWhenEarned:true},
    audience:codeVisualsAllowed(inventory.contentMode)?inventory.contentMode==='tutorial'?'users following reproducible steps':'developers interested in implementation':'general tech/software discovery',
    editorial:outline.editorial||research.editorial,
    storySequence:outline.visits.map(v=>({visitId:v.id,role:v.storyRole})),
    preferredNumericProof:research.claims.filter(c=>outline.preferredProofClaimIds?.includes(c.id)),
    takeawayEvidence:research.claims.filter(c=>c.sourceId===finalSource&&earlierIds.has(c.id)&&editorial?.claims.some(rank=>rank.claimId===c.id&&(rank.category==='IDENTITY'||isCore(rank.category))&&promotionalClaim(rank))),
    omittedEvidence:(outline.editorial||research.editorial)?.claims.filter(c=>!outline.visits.some(v=>v.claimIds.includes(c.claimId))).map(c=>({...c,audienceValue:audienceValue(c),promotionalEligible:promotionalClaim(c),quote:research.claims.find(q=>q.id===c.claimId)?.quote})),
    revisionFeedback:feedback||null,previousScript:previous?.text||previous?.segments.map(s=>s.text).join('\n\n')||null,
    visualInventory:outline.visits.flatMap(v=>productMedia(inventory,v.sectionId)).slice(0,12).map(a=>({id:a.id,sectionId:a.sectionId,type:a.type,description:a.description,features:a.features,width:a.width,height:a.height,quality:a.quality,confidence:a.confidence})),
    visits:outline.visits.map(v=>{
      const section=sections.find(s=>s.id===v.sectionId);
      return {...v,heading:section?.heading,sourceContext:section?.text.slice(0,1800),
        quotes:research.claims.filter(c=>v.claimIds.includes(c.id)),
        claimEditorial:(outline.editorial||research.editorial)?.claims.filter(c=>v.claimIds.includes(c.claimId)).map(c=>({...c,audienceValue:audienceValue(c)})),
        visuals:productMedia(inventory,v.sectionId).slice(0,3).map(a=>({id:a.id,type:a.type,description:a.description,features:a.features,quality:a.quality,confidence:a.confidence,width:a.width,height:a.height,available:!!a.localPath||a.type==='demo'})),
        presentation:productMedia(inventory,v.sectionId).length?'Source product media, established wide':'Contextual page section; no generated code visual'};
    }),
    // Context is a map, not extra factual permission; only assigned quotes may be narrated.
    documentMap:pagesFor(inventory).map(p=>({id:p.id,title:p.title,sections:p.sections.map(s=>({id:s.id,heading:s.heading,order:s.order,media:productMedia(inventory,s.id).map(a=>a.id)}))})),
  };
}
export async function scriptPreviews(id:string|undefined,inventory:Inventory,outline:StoryOutline) {
  const previews:{assetId:string;sectionId:string;path:string}[]=[];
  if(!id)return previews;
  const preferred=outline.visits.flatMap(v=>productMedia(inventory,v.sectionId).slice(0,1));
  const available=preferred.filter((a):a is VisualAsset&{localPath:string;sectionId:string}=>!!a.localPath && !!a.sectionId);
  await mkdir(path.join(jobDir(id),'assets'),{recursive:true});
  for(const asset of available.slice(0,4)) {
    const preview=path.join(jobDir(id),'assets',`script-${asset.id}.jpg`);
    try{await run('ffmpeg',['-y','-i',path.join(jobDir(id),asset.localPath),'-vf','scale=1280:960:force_original_aspect_ratio=decrease','-frames:v','1','-threads','1',preview]);previews.push({assetId:asset.id,sectionId:asset.sectionId,path:preview});}
    catch{/* Missing media remains described; never pretend a preview was inspected. */}
  }
  return previews;
}
