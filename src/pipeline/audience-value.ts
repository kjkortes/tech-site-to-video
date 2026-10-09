import {z} from 'zod';

const rating=z.number().int().min(0).max(5);
// Scores describe the fact, not how attractive its currently available media is.
// This lets one cached research brief serve promotional, developer and tutorial VO.
export const audienceSchema=z.object({
 audienceRelevance:rating,understandability:rating,visualSupport:rating,novelty:rating,
 userValue:rating,technicalComplexity:rating,runtimeCost:rating,
 evidenceKind:z.enum(['user-capability','engineering-validation','implementation-detail']),
 caveatImpact:z.enum(['none','readiness','material','technical-nuance']),
 essentialForAudience:z.boolean(),
});
export type AudienceAssessment=z.infer<typeof audienceSchema>;
export interface AudienceClaim {category:string;thesisContribution:number;audience:AudienceAssessment;}

export const engineeringValidation=/\b(?:byte[- ]identical|byte for byte|reference (?:oracle|implementation|renderer)|CPU (?:reference|compositor)|test harness|benchmark (?:harness|methodology)|pipeline internals|backend details|internal (?:tests?|validation))\b/i;
export const technicalLanguage=/\b(?:renderers?|compositors?|reference implementation|byte[- ]identical|corpus|protocols?|control channel|benchmark harness|pipeline internals|backend details|CLI|JSON|MCP|wgpu|ICC|REST API|TLS\/SSL|certificates?|dependencies|installers?)\b/gi;
const implementation=/\b(?:wgpu|REST API|protocol|control channel|CLI|JSON|MCP|\.fvmrc|Flutter version|build (?:system|feature|issues)|dependencies|crate|certificate)\b/i;
const consequence=/\b(?:without (?:changing|touching|needing|an internet|internet|.*servers)|original pixels|anything you can click|so (?:you|users)|lets? you|allows? you|keep(?:s)? the render|keep(?:s)? (?:previews|the app|transfers) (?:fast|responsive|secure)|preserv(?:e|es|ed) (?:their|the) render|protects? (?:your |the )?(?:files|transfers|data)|non[- ]destructive|run(?:s)? locally|no (?:cloud|account|external servers))\b/i;

export function fallbackAudience(quote:string,category:string):AudienceAssessment {
 const validation=engineeringValidation.test(quote),detail=implementation.test(quote)||(quote.match(technicalLanguage)||[]).length>0;
 const payoff=consequence.test(quote),identity=category==='IDENTITY';
 const readiness=/\b(?:early alpha|alpha|beta|experimental|daily professional|not yet.*replacement)\b/i.test(quote);
 const nuance=/\b(?:byte[- ]identical|byte for byte|reference oracle)\b/i.test(quote);
 const material=category==='CAVEAT'&&!nuance&&!readiness;
 const low=(validation||detail)&&!payoff&&!identity;
 return {
  audienceRelevance:low?1:4,understandability:low?1:4,visualSupport:low?1:4,
  novelty:identity||payoff?4:2,userValue:low?0:readiness||material||payoff?5:3,
  technicalComplexity:low?5:detail?3:identity?2:1,
  runtimeCost:low?4:quote.split(/\s+/).length>65?4:2,
  evidenceKind:validation?'engineering-validation':detail?'implementation-detail':'user-capability',
  caveatImpact:nuance?'technical-nuance':readiness?'readiness':material?'material':'none',
  essentialForAudience:identity,
 };
}
export function audienceValue(rank:AudienceClaim) {
 const a=rank.audience;
 return Math.max(0,Math.min(5,a.audienceRelevance*.3+a.understandability*.2+a.userValue*.3+a.novelty*.2-a.technicalComplexity*.15-a.runtimeCost*.1));
}
export function promotionalClaim(rank:AudienceClaim) {
 if(rank.category==='IDENTITY')return true;
 if(rank.audience.caveatImpact==='technical-nuance')return false;
 if(['MINOR_FEATURE','TECHNICAL_TRIVIA'].includes(rank.category)&&!rank.audience.essentialForAudience)return false;
 if(rank.audience.evidenceKind!=='user-capability' && !rank.audience.essentialForAudience && rank.audience.userValue<3)return false;
 return audienceValue(rank)>=2.6 && rank.audience.understandability>=3;
}
export function audienceBeatScore(rank:AudienceClaim,strongProof=false) {
 // A maintainer-important claim cannot buy runtime with thesis relevance alone.
 return rank.thesisContribution*audienceValue(rank)*rank.audience.visualSupport/5+(strongProof?1:0);
}
export function numericCapabilityProof(quote:string,rank:AudienceClaim) {
 // Ratios make a tested capability concrete; star counts and command counts do
 // not get this preference. At most one such proof is carried into the outline.
 return /\b\d+ of (?:the )?\d+\b/i.test(quote) && rank.category==='CORE_PROOF'
  && rank.thesisContribution>=4 && promotionalClaim(rank) && rank.audience.userValue>=4
  && rank.audience.understandability>=4 && audienceValue(rank)>=3;
}
export const audienceInstructions=`Assess PROJECT IMPORTANCE separately from AUDIENCE VALUE. Default audience: general tech/software viewers, not maintainers or file-format specialists. For each claim score audienceRelevance, understandability, visualSupport (can this value be illustrated, including contextual source prose), novelty, userValue (explicit practical consequence), technicalComplexity and runtimeCost, all 0–5. Complexity and runtime are costs. A thesis-relevant claim may have very low audience value. Classify evidenceKind as user-capability, engineering-validation or implementation-detail, and caveatImpact as none, readiness, material (changes a user's practical decision) or technical-nuance. essentialForAudience is true only when this detail itself is necessary to understand the product's defining value, not merely evidence that its implementation is serious.
Internal test harnesses, CPU reference validation, byte identity, corpus methodology, protocols and build details usually have low audience value. Keep meaningful numeric capability proof when understandable; distinguish its scope from internal methodology. Prefer familiar workflow, actual capabilities and grounded user consequences. Local features or automation are optional. Never infer speed, consistency, security or reliability from internal validation. If a consequence is not explicitly supported, omit the detail in promotional VO. Preserve all claims for developer/tutorial modes. One main readiness/material caveat is usually enough; technical micro-caveats earn runtime only when they change the practical takeaway.`;
