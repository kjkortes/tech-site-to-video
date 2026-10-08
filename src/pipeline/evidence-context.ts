import type { Inventory,Research } from '../lib/types';
import { pagesFor } from './document-map';

// Preserve the source antecedent for terse quotes such as “Stack Levels… mask them”.
// This adds literal evidence, never new narration or a guessed claim.
export function addEvidenceContext(research:Research,inventory:Inventory) {
  const normal=(s:string)=>s.replace(/\s+/g,' ').trim().toLowerCase(),sections=pagesFor(inventory).flatMap(p=>p.sections),changed:string[]=[];
  const generic=new Set(['include','includes','supports','support','project','provides','allows','built','using','through','with','without','these','their']);
  for(const claim of research.claims) {
    const missing=(claim.text.toLowerCase().match(/[a-z]{4,}/g)||[]).filter(w=>!generic.has(w) && !normal(claim.quote).includes(w));
    if(missing.length<2)continue;
    const source=research.sources.find(s=>s.id===claim.sourceId),position=source?.text.indexOf(claim.quote)??-1;
    if(!source || position<0)continue;
    const start=Math.max(0,position-220),preceding=source.text.slice(start,position),boundaries=[...preceding.matchAll(/\S+/g)].map(m=>start+m.index!);
    for(const boundary of boundaries.reverse()) {
      const candidate=source.text.slice(boundary,position+claim.quote.length);
      if(!missing.every(word=>normal(candidate).includes(word)) || !sections.some(s=>s.sourceId===claim.sourceId && normal(s.text).includes(normal(candidate))))continue;
      claim.quote=candidate.trim();changed.push(claim.id);break;
    }
  }
  return changed;
}
