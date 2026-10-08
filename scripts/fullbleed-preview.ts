// Isolated renderer verification with existing research, word timings and source media.
// Preserves the completed source job. No new narration or network research is needed.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cp, mkdir } from 'node:fs/promises';
import { config } from '../src/lib/config';
import { jobDir,readArtifact,writeArtifact } from '../src/lib/store';
import { visualDirector,direct,repairPlan,validatePlan } from '../src/pipeline/direct';
import { recordShots } from '../src/pipeline/record';
import { editVideo } from '../src/pipeline/edit';
import { withModelSettings } from '../src/lib/llm';
import { checkVideo } from '../src/pipeline/qa';
import type { Inventory,Transcript,Research,Script,Job,Shot } from '../src/lib/types';
config.dataDir=path.resolve('test-output/director-smoke');config.database='';
const sourceId=process.argv[2];if(!sourceId)throw new Error('Pass a completed source job ID');
const id=randomUUID(),dir=jobDir(id);await mkdir(dir,{recursive:true});
for(const name of ['assets','exploration','narration.wav','inventory.json','transcript.json','script.json','research.json'])await cp(path.join(jobDir(sourceId),name),path.join(dir,name),{recursive:true});
console.log(`Full-bleed preview: ${id}`);
const inventory=await readArtifact<Inventory>(id,'inventory.json'),speech=await readArtifact<Transcript>(id,'transcript.json'),research=await readArtifact<Research>(id,'research.json'),script=await readArtifact<Script>(id,'script.json'),sourceJob=await readArtifact<Job>(sourceId,'job.json').catch(()=>({llm:{provider:'extractive',model:'',effort:'medium',creativity:'balanced'}} as Job));
inventory.contentMode='promotional';await writeArtifact(id,'job.json',{...sourceJob,id,title:research.title});
let plan;
if(process.argv[3]==='--reuse-plan') {
 const saved=await readArtifact<Shot[]>(sourceId,'shot-plan.json');
 const shots=repairPlan(direct(speech,inventory).map(s=>{
  const earlier=saved.find(p=>p.assetId===s.assetId && p.segmentId===s.segmentId && p.camera?.focus);
  return earlier?{...s,focus:earlier.camera!.focus,motion:'slow-push' as const,rationale:earlier.rationale}:s;
 }),inventory,speech);
 plan={shots,diagnostics:validatePlan(shots,inventory,speech),notes:['Reused inspected source focal regions; refreshed continuous camera, browser readability and ending framing.']};
} else plan=await withModelSettings(sourceJob.llm!,()=>visualDirector(speech,inventory,research,id));
if(!plan.diagnostics.passed)throw new Error(JSON.stringify(plan.diagnostics.issues));
await writeArtifact(id,'director-report.json',plan);await writeArtifact(id,'shot-plan.json',plan.shots);console.log(plan.notes);
const recordings=await recordShots(id,plan.shots,inventory,async detail=>console.log(detail));
await editVideo(id,research.title,plan.shots,recordings,speech);
const qa=await withModelSettings(sourceJob.llm!,()=>checkVideo(id,research,inventory,script,speech,plan.shots,recordings));await writeArtifact(id,'qa.json',qa);
console.log(JSON.stringify({duration:speech.duration,passed:qa.passed,failed:qa.checks.filter(c=>!c.passed),mp4:path.join(dir,'final.mp4')},null,2));
if(!qa.passed)throw new Error('Preview failed QA');
