import { z } from 'zod';
import type { Inventory, Research, StoryOutline } from '../lib/types';
import { pagesFor } from './document-map';
import { modelEnabled, modelJson } from '../lib/llm';

export const storyRevision=2;
const normal=(s:string)=>s.replace(/\s+/g,' ').trim().toLowerCase();
export function sectionClaims(research: Research, inventory: Inventory) {
  const sections=pagesFor(inventory).flatMap(p=>p.sections);
  return sections.map(section=>({section,claims:research.claims.filter(c=>c.sourceId===section.sourceId && normal(section.text).includes(normal(c.quote)))}));
}
export async function buildOutline(research: Research, inventory: Inventory): Promise<StoryOutline> {
  const notes:string[]=[];
  const candidates=sectionClaims(research,inventory).filter(v=>v.claims.length && v.section.sceneId);
  if(!candidates.length) throw new Error('No research quotes belong to mapped document sections. Refresh research before scripting.');
  let selected=candidates;
  if(modelEnabled() && candidates.length>7) {
    try {
      const result=await modelJson('Choose up to seven important section IDs for a guided walkthrough. Keep the first product introduction and a useful caveat/status section if present. Skip repetitive setup and exhaustive installation variants. Choose sections, not a new order: the application preserves DOM order. Do not move screenshots or claims between sections.',{product:research.title,candidates:candidates.map(v=>({sectionId:v.section.id,heading:v.section.heading,claims:v.claims,media:v.section.assetIds}))},z.object({sectionIds:z.array(z.string()).min(1).max(7)}),[], 'navigation');
      const ids=new Set(result.sectionIds);ids.add(candidates[0].section.id);
      selected=candidates.filter(v=>ids.has(v.section.id));
      notes.push('Model selected important visits; document order is enforced by code.');
    } catch(error) {notes.push(`Outline selection used document-order fallback: ${(error as Error).message}`);}
  }
  if(selected.length>7) { const middle=selected.slice(1,-1);selected=[selected[0],...middle.filter((_,i)=>i%Math.max(1,Math.ceil(middle.length/5))===0).slice(0,5),selected.at(-1)!]; }
  return {revision:storyRevision,notes,visits:selected.map((v,i)=>({id:`visit-${i+1}`,sectionId:v.section.id,sceneId:v.section.sceneId!,claimIds:v.claims.map(c=>c.id),purpose:v.section.heading,reason:`Visit document section ${v.section.order}; evidence and media remain in this section`}))};
}
