// Test harness only: exercise the same durable approvals used by the UI/API.
// Never imported by the application or worker.
import assert from 'node:assert/strict';
import {getJob,readArtifact} from '../src/lib/store';
import {approveScript,prepareNarration,approveAudio,saveScript} from '../src/lib/reviews';
import {runPipeline} from '../src/pipeline';
import type {Script} from '../src/lib/types';
export async function approvedTestPipeline(id:string,{regenerate=false,upload,ownText}:{regenerate?:boolean;ownText?:string;upload?:(id:string)=>Promise<void>}={}) {
 await runPipeline(id);let job=(await getJob(id))!;
 if(job.status==='SCRIPT_REVIEW') {
  let script=await readArtifact<Script>(id,'script.json');
  if(regenerate){const {invalidate}=await import('../src/lib/store');job.scriptFeedback='Focus on visual features';await invalidate(job,'SCRIPTING');await runPipeline(id);job=(await getJob(id))!;script=await readArtifact<Script>(id,'script.json');await saveScript(job,script.text!+'\n','edited',script.review!.version);script=await readArtifact<Script>(id,'script.json');}
  if(ownText){await saveScript(job,ownText,'user_provided',script.review!.version);script=await readArtifact<Script>(id,'script.json');}
  await approveScript(job,script.review!.version);
 }
 if(job.status==='NARRATION_PENDING') {
  if(upload)await upload(id);else await prepareNarration(job,'generated');
  await runPipeline(id);job=(await getJob(id))!;
 }
 if(job.status==='AUDIO_REVIEW') {
  const script=await readArtifact<Script>(id,'script.json');
  assert.equal(job.narration?.mismatch?.significant??false,false,job.narration?.mismatch?.message);
  await approveAudio(job,script.review!.version,job.narration!.version);await runPipeline(id);
 }
 return getJob(id);
}
