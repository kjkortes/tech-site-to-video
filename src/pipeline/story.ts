import { z } from 'zod';
import type { Inventory, Research, StoryOutline } from '../lib/types';
import { pagesFor } from './document-map';
import { modelEnabled, modelJson } from '../lib/llm';
import { promotionalPolicy, codeVisualsAllowed } from './content-policy';

import {addOverviewEvidence,productMedia,capabilityOverview} from './script-brief';
export const storyRevision=4;
const normal=(s:string)=>s.replace(/\s+/g,' ').trim().toLowerCase();
const setup=/\b(installers?|installation|dependencies|build commands?|download|platforms?|macos|freebsd)\b/i;
const caveat=/\b(alpha|beta|experimental|limitation|not yet|daily professional|unstable)\b/i;
const surprise=/\b(automat|agents?|rust|shared commands|architecture|designed underneath)/i;
export function sectionClaims(research: Research, inventory: Inventory) {
  const sections=pagesFor(inventory).flatMap(p=>p.sections);
  return sections.map(section=>({section,claims:research.claims.filter(c=>(!c.id.startsWith('script-overview-')||capabilityOverview(c.quote)) && c.sourceId===section.sourceId && normal(section.text).includes(normal(c.quote)))}));
}
export async function buildOutline(research: Research, inventory: Inventory, feedback?:string): Promise<StoryOutline> {
  addOverviewEvidence(research,inventory);
  const notes:string[]=[],promotional=!codeVisualsAllowed(inventory.contentMode);
  let candidates=sectionClaims(research,inventory).filter(v=>v.claims.length && v.section.sceneId);
  if(promotional)candidates=candidates.filter((v,i)=>i===0 || !/\b(command.line|CLI|terminal|build|installation|dependencies|development)\b/i.test(v.section.heading) || /\b(AI agents?|same commands|shared commands)\b/i.test(v.claims.map(c=>c.quote).join(' '))).map((v,i)=>({...v,claims:v.claims.filter(c=>i===0 || caveat.test(c.quote) || surprise.test(c.quote) || !setup.test(c.quote) && !/\b(cli|json|mcp|terminal|npm|cargo|config|protocol)\b/i.test(c.quote))})).filter(v=>v.claims.length);
  if(!candidates.length) throw new Error('No research quotes belong to mapped document sections. Refresh research before scripting.');
  const hasMedia=(v:typeof candidates[number])=>productMedia(inventory,v.section.id).length>0;
  const intro=candidates[0],ending=candidates.filter(v=>caveat.test(v.claims.map(c=>c.quote).join(' '))).at(-1);
  const distinctive=(v:typeof candidates[number])=>/\b(?:AI agents?|same commands|shared commands|without an? (?:account|cloud)|no (?:account|cloud)|self.host|end.to.end|peer.to.peer|encrypted|encryption|HTTPS|offline)\b/i.test(v.claims.map(c=>c.quote).join(' '));
  const differentiator=candidates.filter((v,i)=>i>0 && v!==ending && distinctive(v)).at(-1)||candidates.find((v,i)=>i>0 && v!==ending && surprise.test(v.claims.map(c=>c.quote).join(' ')));
  const proof=candidates.filter(v=>v!==intro && v!==ending && v!==differentiator).sort((a,b)=>Number(!!hasMedia(b))-Number(!!hasMedia(a))||a.section.order-b.section.order).slice(0,3);
  let selected=promotional?candidates.filter(v=>[intro,...proof,differentiator,ending].includes(v)):candidates;
  if(modelEnabled()) {
    try {
      const result=await modelJson('Select three to six sections that earn their runtime. Build discovery: immediate product identity, show core experience, escalate with the strongest visible capabilities, ONE unusual differentiator, important caveat and payoff. Avoid a feature catalogue. Prefer sections with real product media. Automation deserves one concise payoff, not separate CLI/JSON/MCP explanations. Skip installers, OS lists and installation trivia. 40–50 seconds is useful when earned; shorter is fine. Select a subset in document order. Group related features into a story point, and avoid selecting several sections that repeat the same consequence. Apply revisionFeedback to emphasis: a requested angle still needs source order, visible capability and a useful caveat. Each visit must explain why the next idea follows. Source quotes and media ownership stay local; never invent claims.',{policy:promotional?promotionalPolicy:'Developer/tutorial walkthrough',product:research.title,revisionFeedback:feedback,candidates:candidates.map(v=>({sectionId:v.section.id,heading:v.section.heading,claims:v.claims,media:productMedia(inventory,v.section.id).slice(0,3).map(a=>({id:a.id,type:a.type,description:a.description,features:a.features,quality:a.quality,confidence:a.confidence})),hasProductMedia:hasMedia(v)}))},z.object({sectionIds:z.array(z.string()).min(1).max(6)}),[], 'navigation');
      const ids=new Set(result.sectionIds);ids.add(intro.section.id);if(ending)ids.add(ending.section.id);if(differentiator)ids.add(differentiator.section.id);
      selected=candidates.filter(v=>ids.has(v.section.id));
      notes.push('Selected discovery beats; preserve source order and complete claim/media ownership.');
    } catch(error) {notes.push(`Outline selection used product-first fallback: ${(error as Error).message}`);}
  }
  if(selected.length>6) {
    const anchors=new Set([selected[0],selected.at(-1)!,...(differentiator && selected.includes(differentiator)?[differentiator]:[])]);
    const optional=selected.filter(v=>!anchors.has(v)).sort((a,b)=>Number(hasMedia(b))-Number(hasMedia(a))||a.section.order-b.section.order).slice(0,6-anchors.size);
    selected=selected.filter(v=>anchors.has(v)||optional.includes(v));
  }
  if(promotional)notes.push(promotionalPolicy);
  return {revision:storyRevision,notes,visits:selected.map((v,i)=>{
    const role=i===0?'introduction':v===ending?'caveat':v===differentiator?'surprise':i===1?'core-experience':'proof';
    return {id:`visit-${i+1}`,sectionId:v.section.id,sceneId:v.section.sceneId!,claimIds:v.claims.map(c=>c.id),purpose:v.section.heading,reason:`${role}: ${hasMedia(v)?'actual product media proves the visible capability':'source prose connects the product story'}; keep evidence and media associated with this section`,storyRole:role};
  })};
}
