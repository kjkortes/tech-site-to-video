import type { DiversityReport, Inventory, Script, Shot, Transcript } from '../lib/types';
import { validateCoverage } from './coverage';
import {productOpening} from './script-quality';
import { validateCameraPlan } from './camera-policy';

export function validateRetention(shots:Shot[],inventory:Inventory,transcript:Transcript,script?:Script):DiversityReport {
  const issues:DiversityReport['issues']=[],opening=shots[0];
  const add=(code:string,detail:string,shotId?:string,severity:'error'|'warning'='warning')=>issues.push({code,detail,shotId,severity});
  issues.push(...validateCameraPlan(shots,inventory,transcript).issues);
  if(!productOpening(transcript.segments[0]?.text||'',script?.title))add('product-first','Opening does not immediately identify/explain the product',opening?.id);
  const coverage=validateCoverage(shots,inventory,transcript);
  issues.push(...coverage.issues.filter(i=>['readability-time','short-payoff','visual-coverage','unexplained-cutaway'].includes(i.code)));
  if(script && script.segments.filter(s=>/^(?:It (?:has|also|supports)|Also,|Another feature)/i.test(s.text)).length>=3)add('flat-enumeration','Several visits read as a feature list; connect the ideas and remove minor details');
  if(script?.outline && script.outline.visits.length>=4 && !script.outline.visits.slice(1,-1).some(v=>['technical','proof','surprise'].includes(v.storyRole||'')))add('middle-progression','Middle visits need a concrete proof/differentiator, when supported by the source');
  return {passed:!issues.some(i=>i.severity==='error'),score:Math.max(0,100-issues.reduce((n,i)=>n+(i.severity==='error'?20:3),0)),scrollDuration:shots.reduce((n,s)=>n+(s.walkthrough?.transition?.duration||0),0),issues};
}
