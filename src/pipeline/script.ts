import { z } from 'zod';
import { modelJson, modelEnabled } from '../lib/llm';
import type { Research, Inventory, Script, StoryOutline } from '../lib/types';
import { buildOutline, storyRevision } from './story';
import { pagesFor } from './document-map';
import { promotionalPolicy, codeVisualsAllowed } from './content-policy';

import {addOverviewEvidence,capabilityOverview} from './script-brief';
import {writePromotionalScript,type ScriptWritingContext} from './promotional-script';
import {productOpening,inspectScriptQuality,scriptWritingRevision,wordCount} from './script-quality';

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
  if(script.revision===storyRevision && (!script.review || script.review.source==='generated') && !productOpening(script.segments[0]?.text||'',script.title)) throw new Error('Opening must immediately identify the product: This is [PRODUCT] — [description].');
}
export async function writeScript(research: Research, inventory: Inventory, outline?: StoryOutline, feedback?:string, context:ScriptWritingContext={}): Promise<Script> {
  addOverviewEvidence(research,inventory);
  outline ||= await buildOutline(research,inventory,feedback);
  const intro=pagesFor(inventory).flatMap(p=>p.sections).find(s=>s.id===outline!.visits[0]?.sectionId);
  const overview=research.claims.filter(c=>c.id.startsWith('script-overview-') && capabilityOverview(c.quote) && c.sourceId===intro?.sourceId && intro.text.replace(/\s+/g,' ').toLowerCase().includes(c.quote.replace(/\s+/g,' ').toLowerCase())).map(c=>c.id);
  outline={...outline,visits:outline.visits.map((v,i)=>i===0?{...v,claimIds:[...new Set([...v.claimIds,...overview])]}:v)};
  if(modelEnabled() && !codeVisualsAllowed(inventory.contentMode))return writePromotionalScript(research,inventory,outline,feedback,context,validateScript);
  let segments: Script['segments'];
  if (modelEnabled()) {
    const result = await modelJson('Write a coherent guided walkthrough, typically 40–50 seconds and 85–110 words, shorter when the source does not earn more time. Return {segments:[{visitId,text,claimIds}]}, EXACTLY one segment per supplied visit, in that order. The first spoken sentence MUST start "This is [exact product title]," followed immediately by a clear sourced description/value proposition. No branding VO, capability list before the product, or filler such as "Here is a look", "Today", "this repository", or "let us take a look". Explain the product immediately, then walk through the selected sections with natural connective wording. Create escalation rather than a flat feature list: what it is, why the core experience matters, a concrete impressive capability, then a source-backed differentiator/surprise and useful caveat. Each section should explain WHY the next idea follows, without inventing benefits. Keep only important details. Avoid repeated "It has/It also supports" enumeration. You may preview the next section with factual curiosity only if the immediately following visit pays it off. Include a brief connective clause before detailed screenshot explanations so the browser can establish the source; then discuss the same visual for a complete readable span (dense UI roughly 4–6s). Do not split one explanation into unrelated shots. No arbitrary 60-second target or padded movement. Discuss each section only using its assigned quotes. Do not make factual claims about scrolling, page locations, or clicking; navigation need not be narrated. Default promotional mode: no code, commands, protocol walkthroughs, installer lists or OS lists. Explain automation in one short everyday sentence only when it adds an interesting payoff. Use developer/tutorial mode for syntax. Finish the final visit with a brief useful sourced takeaway or caveat, not a long CTA or unsupported endorsement. Give the final sourced caveat/takeaway one concise full sentence, approximately 3–5 seconds, over the strongest product visual. Every factual clause must be entailed by its cited quotes. Do not add benefits, pricing, evaluations, or guessed architecture. Creativity belongs in wording, never in changing visit order. Apply any supplied revisionFeedback to the new script, retaining source evidence and visit associations.',
      {revisionFeedback:feedback,policy:inventory.contentMode==='developer'||inventory.contentMode==='tutorial'?'Developer/tutorial narration':promotionalPolicy,product:research.title,visits:outline.visits.map(v=>({...v,quotes:research.claims.filter(c=>v.claimIds.includes(c.id)),section:pagesFor(inventory).flatMap(p=>p.sections).find(s=>s.id===v.sectionId)?.heading}))},
      z.object({segments:z.array(z.object({visitId:z.string(),text:z.string().min(1).max(1000),claimIds:z.array(z.string()).min(1)})).min(1).max(6)}),[], 'script');
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
  const script:Script={contentMode:inventory.contentMode||'promotional',title:research.title,mode:modelEnabled()?'model':'extractive',revision:storyRevision,outline,segments};
  validateScript(script,research,inventory);
  if(!modelEnabled() && !codeVisualsAllowed(inventory.contentMode))script.quality={revision:scriptWritingRevision,status:'advisory',selectedCandidate:'source-excerpts',wordCount:wordCount(segments.map(s=>s.text).join(' ')),revised:false,issues:inspectScriptQuality(script,inventory,outline),notes:['Source-excerpt mode preserves literal evidence; model candidate/creative revision and feedback interpretation are unavailable. Edit the script or configure a writing model.'],candidates:[],inspectedAssetIds:[],feedback};
  return script;
}
