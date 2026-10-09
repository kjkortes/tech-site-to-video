// Recheck a rendered preview against the current deterministic planner and QA.
import path from 'node:path';
import { config } from '../src/lib/config';
import { readArtifact, writeArtifact } from '../src/lib/store';
import { direct, validatePlan } from '../src/pipeline/direct';
import { validateRetention } from '../src/pipeline/retention';
import { checkVideo } from '../src/pipeline/qa';
import { withModelSettings } from '../src/lib/llm';
import type { Inventory, Transcript, Script, Research, Shot, ShotResult } from '../src/lib/types';

const dir=path.resolve(process.argv[2]||'');if(!process.argv[2])throw new Error('Pass the preview job directory');
config.dataDir=path.dirname(path.dirname(dir));config.database='';const id=path.basename(dir);
const inventory=await readArtifact<Inventory>(id,'inventory.json'),transcript=await readArtifact<Transcript>(id,'transcript.json'),script=await readArtifact<Script>(id,'script.json'),research=await readArtifact<Research>(id,'research.json');
const shots=await readArtifact<Shot[]>(id,'shot-plan.json'),recordings=await readArtifact<ShotResult[]>(id,'recordings.json');
const current=direct(transcript,inventory);
if(current.some((s,i)=>JSON.stringify([s.start,s.duration,s.assetId,s.type,s.mediaMotion])!==JSON.stringify([shots[i]?.start,shots[i]?.duration,shots[i]?.assetId,shots[i]?.type,shots[i]?.mediaMotion])))throw new Error('Rendered preview needs replanning/recapture after implementation changes');
const retention=validateRetention(shots,inventory,transcript,script),plan=validatePlan(shots,inventory,transcript);
const qa=await withModelSettings({provider:'extractive',model:'',effort:'default',creativity:'balanced'},()=>checkVideo(id,research,inventory,script,transcript,shots,recordings));
await writeArtifact(id,'retention-report.json',retention);await writeArtifact(id,'qa.json',qa);
console.log(JSON.stringify({planPassed:plan.passed,retention,qaPassed:qa.passed,qaScore:qa.score,failed:qa.checks.filter(c=>!c.passed)},null,2));
if(!plan.passed || !qa.passed)throw new Error('Retention preview validation failed');
