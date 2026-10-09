import type {Script,Inventory,StoryOutline} from '../lib/types';
import {isCore} from './editorial';
export const qualityDimensions=['hook','clarity','progression','visualSupport','differentiation','speech','density','thesisFidelity'] as const;
export type QualityDimension=typeof qualityDimensions[number];
export interface ScriptQualityIssue {code:string;detail:string;}
export interface ScriptQualityReport {
  revision:number;scriptVersion?:number;status:'checked'|'advisory';selectedCandidate:string;wordCount:number;revised:boolean;
  dimensions?:Record<QualityDimension,number>;issues:ScriptQualityIssue[];notes:string[];
  candidates:{id:string;angle:string;wordCount:number;supported:boolean;issues:ScriptQualityIssue[];dimensions?:Record<QualityDimension,number>}[];
  model?:{provider:string;model:string;effort:string;creativity:string};
  inspectedAssetIds:string[];feedback?:string;
}
export const scriptWritingRevision=2;
export const wordCount=(text:string)=>(text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)||[]).length;
export function productOpening(text:string,title?:string) {
  const name=title?title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'):'[^,—–:]+?';
  return new RegExp(`^This is ${name}\\s*(?:[,—–:]| - )\\s*\\S`,'i').test(text.trim());
}
export function inspectScriptQuality(script:Script,inventory:Inventory,outline:StoryOutline):ScriptQualityIssue[] {
  const issues:ScriptQualityIssue[]=[],text=script.segments.map(s=>s.text).join(' '),sentences=text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const add=(code:string,detail:string)=>issues.push({code,detail});
  if(!productOpening(script.segments[0]?.text||'',script.title))add('hook-identity','The first sentence must name and describe the software immediately.');
  if(/\b(?:here(?:’s| is) a look|today we|let(?:’s| us) take a look|software,? in a minute|but wait|you won.t believe)\b/i.test(text))add('filler','Remove setup, series branding or fake clickbait.');
  if(wordCount(text)>120)add('word-budget',`Draft has ${wordCount(text)} words; trim toward 80–115 without losing its payoff.`);
  if(sentences.some(s=>wordCount(s)>35))add('long-clause','Break a dense sentence into shorter spoken clauses.');
  if(/\b(?:CLI|JSON|MCP|control channel|wgpu|ICC|protocol|dependency|installers?)\b/i.test(text))add('technical-trivia','Replace protocol/build/installation details with their visible user consequence.');
  if(/\b(?:the (?:source|README|documentation) (?:says|states|describes|claims)|according to the (?:source|README|documentation))\b/i.test(text))add('spoken-attribution','Keep research citations in claimIds; speak the grounded product fact directly.');
  const starts=script.segments.slice(1).map(s=>s.text.trim().match(/^\w+/)?.[0].toLowerCase()||'');
  const bridges=starts.filter(s=>['its','for','that','beyond'].includes(s));
  if(bridges.length>=3 && bridges.length>=starts.length*.6)add('summary-cadence','The middle reads like linked documentation summaries; vary rhythm and build a clear contrast/payoff.');
  if([...new Set(starts)].some(word=>starts.filter(s=>s===word).length>=3))add('repeated-start','Several beats begin the same way; vary the sentence structure.');
  const brief=outline.editorial||script.outline?.editorial;
  if(brief) {
    const ranks=new Map(brief.claims.map(c=>[c.claimId,c]));
    const body=script.segments.slice(1).filter(s=>!s.claimIds.some(id=>ranks.get(id)?.category==='CAVEAT'));
    const coreBody=body.filter(s=>s.claimIds.some(id=>isCore(ranks.get(id)?.category||'')));
    if(brief.claims.some(c=>isCore(c.category)) && (!coreBody.length || coreBody.length<body.length/2))add('thesis-fidelity','The opening identifies the project, but most body beats do not prove its thesis. Restore core workflow/compatibility/architecture evidence; cut generic details or secondary differentiation that hijacks the story.');
    const used=new Set(script.segments.flatMap(s=>s.claimIds));
    if(brief.strongestProof.some(p=>p.claimIds.every(id=>!used.has(id))) && script.segments.some(s=>s.claimIds.length && s.claimIds.every(id=>['MINOR_FEATURE','TECHNICAL_TRIVIA'].includes(ranks.get(id)?.category||''))))add('editorial-importance','A minor feature displaced omitted strongest core proof. Give runtime to the thesis evidence.');
  }
  return issues;
}
