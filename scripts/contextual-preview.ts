// Isolated renderer verification with existing research, word timings and source media.
// Preserves the completed source job. No new narration or network research is needed.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cp, mkdir } from 'node:fs/promises';
import { config } from '../src/lib/config';
import { jobDir,readArtifact,writeArtifact } from '../src/lib/store';
import { direct,repairPlan,validatePlan } from '../src/pipeline/direct';
import { recordShots } from '../src/pipeline/record';
import { editVideo } from '../src/pipeline/edit';
import { withModelSettings } from '../src/lib/llm';
import { checkVideo } from '../src/pipeline/qa';
import { cameraSummary, sourceTypeFor } from '../src/pipeline/camera-policy';
import type { Inventory,Transcript,Research,Script,Job,Shot } from '../src/lib/types';
config.dataDir=path.resolve('test-output/director-smoke');config.database='';
const sourceId=process.argv[2];if(!sourceId)throw new Error('Pass a completed source job ID');
const id=randomUUID(),dir=jobDir(id);await mkdir(dir,{recursive:true});
for(const name of ['assets','exploration','narration.wav','inventory.json','transcript.json','script.json','research.json'])await cp(path.join(jobDir(sourceId),name),path.join(dir,name),{recursive:true});
console.log(`Contextual preview: ${id}`);
const inventory=await readArtifact<Inventory>(id,'inventory.json'),speech=await readArtifact<Transcript>(id,'transcript.json'),research=await readArtifact<Research>(id,'research.json'),script=await readArtifact<Script>(id,'script.json'),sourceJob=await readArtifact<Job>(sourceId,'job.json').catch(()=>({llm:{provider:'extractive',model:'',effort:'medium',creativity:'balanced'}} as Job));
inventory.contentMode='promotional';inventory.sourceUrl=sourceJob.url||research.sources[0]?.url;inventory.sourceType=sourceTypeFor(inventory);await writeArtifact(id,'inventory.json',inventory);await writeArtifact(id,'job.json',{...sourceJob,id,title:research.title});
const saved=await readArtifact<Shot[]>(sourceId,'shot-plan.json');
const shots=repairPlan(direct(speech,inventory).map(s=>{
  if(process.argv[3]!=='--inspect-detail' || s.cameraMode!=='media' || s.duration<7)return s;
  const earlier=saved.find(p=>p.assetId===s.assetId && p.segmentId===s.segmentId && p.camera?.focus && p.camera.focus.width<.3 && p.camera.focus.height<.3);
  const beat=speech.segments.find(b=>b.id===s.segmentId)!;
  const feature=inventory.assets?.find(a=>a.id===s.assetId)?.features.join(' ').match(/layers|masks?|Curves|Vibrance/gi)?.find(f=>beat.text.includes(f));
  return earlier && feature?{...s,type:'zoom_region' as const,cameraMode:'detail' as const,focus:earlier.camera!.focus,camera:{focus:earlier.camera!.focus,motion:'slow-push' as const,duration:s.duration,offset:0,maxZoom:1.08,reason:'Previously inspected source controls illustrate the editing feature explicitly named by this narration.',detailText:feature}}:s;
}),inventory,speech);
const plan={shots,diagnostics:validatePlan(shots,inventory,speech),notes:['Preserved narration and word timings; native source-page intro, wide media, optional explicit temporary detail and exact page returns.']};
console.log(JSON.stringify({shots:shots.map(s=>({id:s.id,start:s.start,duration:s.duration,mode:s.cameraMode,heading:s.walkthrough?.location.heading})),camera:cameraSummary(shots,inventory),diagnostics:plan.diagnostics},null,2));
await writeArtifact(id,'camera-report.json',cameraSummary(shots,inventory));
if(!plan.diagnostics.passed)throw new Error(JSON.stringify(plan.diagnostics.issues));
await writeArtifact(id,'director-report.json',plan);await writeArtifact(id,'shot-plan.json',plan.shots);console.log(plan.notes);
const recordings=await recordShots(id,plan.shots,inventory,async detail=>console.log(detail));
await editVideo(id,research.title,plan.shots,recordings,speech);
const qa=await withModelSettings({...sourceJob.llm!,provider:'extractive'},()=>checkVideo(id,research,inventory,script,speech,plan.shots,recordings));await writeArtifact(id,'qa.json',qa);
console.log(JSON.stringify({duration:speech.duration,passed:qa.passed,failed:qa.checks.filter(c=>!c.passed),mp4:path.join(dir,'final.mp4')},null,2));
if(!qa.passed)throw new Error('Preview failed QA');
