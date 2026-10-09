import type {Script,Inventory,StoryOutline} from '../lib/types';
import {isCore} from './editorial';
import {promotionalClaim,technicalLanguage,engineeringValidation,fallbackAudience,audienceValue} from './audience-value';
export const qualityDimensions=['hook','clarity','progression','visualSupport','differentiation','speech','density','thesisFidelity','audienceValue'] as const;
export type QualityDimension=typeof qualityDimensions[number];
export interface ScriptQualityIssue {code:string;detail:string;}
export interface ScriptQualityReport {
  revision:number;scriptVersion?:number;status:'checked'|'advisory';selectedCandidate:string;wordCount:number;revised:boolean;
  dimensions?:Record<QualityDimension,number>;issues:ScriptQualityIssue[];notes:string[];
  candidates:{id:string;angle:string;wordCount:number;supported:boolean;issues:ScriptQualityIssue[];dimensions?:Record<QualityDimension,number>}[];
  model?:{provider:string;model:string;effort:string;creativity:string};
  inspectedAssetIds:string[];feedback?:string;
}
export const scriptWritingRevision=3;
export const wordCount=(text:string)=>(text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)||[]).length;
export function productOpening(text:string,title?:string) {
  const name=title?title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'):'[^,—–:]+?';
  return new RegExp(`^This is ${name}\\s*(?:[,—–:]| - )\\s*\\S`,'i').test(text.trim());
}
export function inspectScriptQuality(script:Script,inventory:Inventory,outline:StoryOutline):ScriptQualityIssue[] {
  const issues:ScriptQualityIssue[]=[],text=script.segments.map(s=>s.text).join(' '),sentences=text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const add=(code:string,detail:string)=>issues.push({code,detail});
  const promotional=(script.contentMode||inventory.contentMode||'promotional')==='promotional';
  if(!productOpening(script.segments[0]?.text||'',script.title))add('hook-identity','The first sentence must name and describe the software immediately.');
  if(/\b(?:here(?:’s| is) a look|today we|let(?:’s| us) take a look|software,? in a minute|but wait|you won.t believe)\b/i.test(text))add('filler','Remove setup, series branding or fake clickbait.');
  if(wordCount(text)>120)add('word-budget',`Draft has ${wordCount(text)} words; trim toward 80–115 without losing its payoff.`);
  if(sentences.some(s=>wordCount(s)>35))add('long-clause','Break a dense sentence into shorter spoken clauses.');
  if(promotional) {
    const technicalSentences=script.segments.flatMap((segment,index)=>segment.text.split(/(?<=[.!?])\s+/).filter((sentence,j)=>{
      if(index===0 && j===0)return false; // A defining implementation identity is allowed.
      const ranks=(outline.editorial||script.outline?.editorial)?.claims.filter(c=>segment.claimIds.includes(c.claimId));
      if(ranks?.length && ranks.every(c=>c.audience?.essentialForAudience))return false;
      return (sentence.match(technicalLanguage)||[]).length>0 && audienceValue({category:'CORE_PROOF',thesisContribution:5,audience:fallbackAudience(sentence,'CORE_PROOF')})<2.6;
    }));
    if(technicalSentences.length) add('audience-value','Cut specialist detail that has no explicit viewer payoff, or narrate only a user consequence entailed by its assigned quotes. Project importance alone does not earn runtime.');
    if(technicalSentences.length>=2 || technicalSentences.some(s=>engineeringValidation.test(s)) || technicalSentences.some(s=>(s.match(technicalLanguage)||[]).length>=2))add('technical-density','Promotional VO spends runtime on validation/methodology or stacked specialist terms. Keep meaningful capability proof and one practical caveat; omit technical micro-caveats.');
    if(/\b(?:CLI|JSON|MCP|control channel|wgpu|ICC|protocol|dependency|installers?)\b/i.test(technicalSentences.join(' ')))add('technical-trivia','Replace protocol/build/installation details with a source-supported user consequence, or cut them.');
    if(/\b(?:I['’]d|I would|you should) explore it for (?:that|its|the) ambition\b/i.test(text))add('weak-takeaway','End with a clear core takeaway and the main caveat; avoid a vague invitation to explore an ambition.');
    if(/\b(?:the |its )?ambition includes\b/i.test(text))add('synthetic-capability','Describe supported capabilities as things the product does; an ambition does not have a feature list.');
  }
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
    if(promotional) {
      if(outline.preferredProofClaimIds?.length && (outline.preferredProofClaimIds.some(id=>!used.has(id)) || !/\b\d+ of (?:the )?\d+\b/i.test(text)))add('audience-proof','Selected numeric capability proof has high audience value. Use its scoped result before spending runtime on optional differentiators or generic feature summaries; do not add technical micro-caveats.');
      if(brief.claims.some(c=>used.has(c.claimId)&&c.audience&&!promotionalClaim(c)))add('audience-value','The draft cites low-audience-value evidence excluded from promotional selection. Cut the validation/technical nuance unless its explicit practical consequence earns runtime.');
      const caveats=brief.claims.filter(c=>used.has(c.claimId)&&c.category==='CAVEAT'&&c.audience?.caveatImpact!=='technical-nuance');
      if(caveats.filter(c=>!c.audience?.essentialForAudience).length>1)add('caveat-stack','Prefer one main practical caveat; additional limits need a material effect on the viewer’s decision.');
    }
    if(brief.strongestProof.some(p=>p.claimIds.every(id=>!used.has(id))) && script.segments.some(s=>s.claimIds.length && s.claimIds.every(id=>['MINOR_FEATURE','TECHNICAL_TRIVIA'].includes(ranks.get(id)?.category||''))))add('editorial-importance','A minor feature displaced omitted strongest core proof. Give runtime to the thesis evidence.');
  }
  return issues;
}
