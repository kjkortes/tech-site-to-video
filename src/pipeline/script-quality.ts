import type {Script,Inventory,StoryOutline} from '../lib/types';
import {productMedia} from './script-brief';
export const qualityDimensions=['hook','clarity','progression','visualSupport','differentiation','speech','density'] as const;
export type QualityDimension=typeof qualityDimensions[number];
export interface ScriptQualityIssue {code:string;detail:string;}
export interface ScriptQualityReport {
  revision:number;scriptVersion?:number;status:'checked'|'advisory';selectedCandidate:string;wordCount:number;revised:boolean;
  dimensions?:Record<QualityDimension,number>;issues:ScriptQualityIssue[];notes:string[];
  candidates:{id:string;angle:string;wordCount:number;supported:boolean;issues:ScriptQualityIssue[];dimensions?:Record<QualityDimension,number>}[];
  model?:{provider:string;model:string;effort:string;creativity:string};
  inspectedAssetIds:string[];feedback?:string;
}
export const scriptWritingRevision=1;
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
  const surprises=outline.visits.filter(v=>v.storyRole==='surprise');
  const usedSurprise=script.segments.findIndex(s=>surprises.some(v=>v.id===s.visitId));
  if(surprises.length && usedSurprise<0)add('missing-differentiator','Preserve the strongest unusual source-backed point.');
  if(usedSurprise>0 && usedSurprise<script.segments.length/2)add('early-reveal','Save the differentiator for the latter half, after showing the core product.');
  if(outline.visits.some(v=>productMedia(inventory,v.sectionId).length) && script.segments.every(s=>!productMedia(inventory,s.sectionId||'').length))add('visual-evidence','The story skips the available visuals in its evidence-backed visits.');
  return issues;
}
