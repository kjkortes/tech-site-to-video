// Conservative fallback for source-backed grouped capabilities. Semantic role
// classification still belongs to the editorial model; no product names here.
export const implementationProof=/\b(?:\d+ of (?:the )?\d+|\d+(?:\.\d+)?x faster|benchmark|(?:compatibility |rendering )?test (?:files|set|results|corpus)|tested|tests (?:show|pass)|preserved the render)\b/i;
const exclusions=/https?:|\b[a-z0-9-]+\.(?:com|org|net)\b|\bstars?\b|sponsors?|\bbest\b|fastest|\bleading\b|caption card|come say hi|join (?:us|our)/i;
export function capabilityOverview(quote:string) {
 return quote.length>=35 && quote.length<=450 && /[,;].*[,;]/.test(quote)
  && /\b(?:supports?|features?|includes?|offers?|tools?|app|application|software|editor|layers|masks|files|folders|devices|sharing|editing|formats|pipeline|suite)\b/i.test(quote)
  && !exclusions.test(quote) && !implementationProof.test(quote);
}
export function experienceFacets(quote:string):string[] {
 // Lists of settings/actions within one feature are depth, not product breadth.
 const lists=quote.split(/(?<=[.!?])\s+/).filter(list=>capabilityOverview(list)&&!/^\s*(?:stack|reorder|adjust|toggle|configure|switch)\b/i.test(list)).map(list=>{
  const parts=list.replace(/^.*?[—:]/,'').split(/[,;]|\s+and\s+/).map(part=>part.trim().replace(/[.!?]$/,''));
  return parts.filter(p=>p.length>=3 && p.split(/\s+/).length<=5 && !/\b(?:native|written|Rust|source|offline|pure|app)\b/i.test(p)).slice(0,8);
 });
 return lists.sort((a,b)=>b.length-a.length)[0]||[];
}
const stop=new Set('the with from into and for its you your this that live real supports supported includes offers editing'.split(' '));
export const experienceWords=(text:string)=>(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]).map(t=>t.replace(/(?:ing|s)$/,'')).filter(t=>!stop.has(t));
export function facetCoverage(text:string,facets:string[]) {
 const words=new Set(experienceWords(text));
 let covered=0;
 for(const facet of facets){const match=experienceWords(facet).find(w=>words.has(w));if(match){covered++;words.delete(match);}}
 return covered;
}
