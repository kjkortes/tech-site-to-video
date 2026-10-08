import { z } from 'zod';
import { modelJson, modelEnabled } from '../lib/llm';
import type { Research, Inventory, Script, StoryOutline } from '../lib/types';
import { buildOutline, storyRevision } from './story';
import { pagesFor } from './document-map';

export function validateScript(script: Script, research: Research, inventory: Inventory) {
  let previousPage=-1, previousSection=-1;
  const pages=pagesFor(inventory);
  for (const segment of script.segments) {
    if(script.revision===storyRevision && (!segment.sectionId || !segment.visitId)) throw new Error('Walkthrough narration must retain its section and visit identity');
    const scene = inventory.scenes.find(s => s.id === segment.sceneId);
    if (!scene) throw new Error(`Narration has no discovered visual: ${segment.id}`);
    if (segment.claimIds.some(id => !research.claims.some(c => c.id === id))) throw new Error('Narration references an unknown claim');
    if (segment.claimIds.some(id => research.claims.find(c => c.id === id)?.sourceId !== scene.sourceId)) throw new Error('Narration is paired with footage from a different source');
    if (!segment.text.trim()) throw new Error('Empty narration segment');
    if (script.mode === 'model' && !segment.claimIds.length) throw new Error('Model narration must cite at least one researched claim per segment');
    if(segment.sectionId) {
      const page=pages.find(p=>p.sections.some(s=>s.id===segment.sectionId)); const section=page?.sections.find(s=>s.id===segment.sectionId);
      if(!page || !section || scene.sectionId!==section.id) throw new Error('Narration has no matching document section');
      if(page.order<previousPage || page.order===previousPage && section.order<previousSection) throw new Error('Narration conflicts with document order; regenerate script');
      const normal=(s:string)=>s.replace(/\s+/g,' ').trim().toLowerCase();
      if(segment.claimIds.some(id=>!normal(section.text).includes(normal(research.claims.find(c=>c.id===id)!.quote)))) throw new Error('Narration cites evidence from a different section');
      previousPage=page.order;previousSection=section.order;
    }
  }
  if(script.revision===storyRevision && !script.segments[0]?.text.toLowerCase().startsWith(`this is ${script.title.toLowerCase()},`)) throw new Error('Opening must immediately identify the product: This is [PRODUCT], [description].');
}
export async function writeScript(research: Research, inventory: Inventory, outline?: StoryOutline): Promise<Script> {
  outline ||= await buildOutline(research,inventory);
  let segments: Script['segments'];
  if (modelEnabled()) {
    const result = await modelJson('Write a coherent guided walkthrough, approximately 60 seconds and 125–145 words. Return {segments:[{visitId,text,claimIds}]}, EXACTLY one segment per supplied visit, in that order. The first spoken sentence MUST start "This is [exact product title]," followed immediately by a clear sourced description/value proposition. No branding VO, capability list before the product, or filler such as "Here is a look", "Today", "this repository", or "let us take a look". Explain the product immediately, then walk through the selected sections with natural connective wording. Discuss each section only using its assigned quotes. Do not make factual claims about scrolling, page locations, or clicking; navigation need not be narrated. Code is discussed only for CLI, APIs, installation, configuration, or architecture. Finish the final visit with a brief useful sourced takeaway or caveat, not a long CTA or unsupported endorsement. Every factual clause must be entailed by its cited quotes. Do not add benefits, pricing, evaluations, or guessed architecture. Creativity belongs in wording, never in changing visit order.',
      {product:research.title,visits:outline.visits.map(v=>({...v,quotes:research.claims.filter(c=>v.claimIds.includes(c.id)),section:pagesFor(inventory).flatMap(p=>p.sections).find(s=>s.id===v.sectionId)?.heading}))},
      z.object({segments:z.array(z.object({visitId:z.string(),text:z.string().min(1).max(1000),claimIds:z.array(z.string()).min(1)})).min(1).max(7)}),[], 'script');
    if(result.segments.length!==outline.visits.length || result.segments.some((s,i)=>s.visitId!==outline!.visits[i].id || s.claimIds.some(id=>!outline!.visits[i].claimIds.includes(id)))) throw new Error('Script changed the walkthrough visits or their evidence');
    segments=result.segments.map((s,i)=>({...s,id:`segment-${i+1}`,sceneId:outline!.visits[i].sceneId,sectionId:outline!.visits[i].sectionId}));
  } else {
    segments=outline.visits.map((visit,i)=>{
      const claim=research.claims.find(c=>c.id===visit.claimIds[0])!;
      let text=claim.quote;
      if(i===0) {
        const escaped=research.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        const description=text.replace(new RegExp(`^${escaped}\\s+(?:is|:)\\s+`,'i'),'');
        text=`This is ${research.title}, ${description.charAt(0).toLowerCase()}${description.slice(1)}`;
      }
      return {id:`segment-${i+1}`,visitId:visit.id,sectionId:visit.sectionId,sceneId:visit.sceneId,text,claimIds:[claim.id]};
    });
  }
  const script:Script={title:research.title,mode:modelEnabled()?'model':'extractive',revision:storyRevision,outline,segments};
  validateScript(script,research,inventory);return script;
}
