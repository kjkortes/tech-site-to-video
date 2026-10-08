import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import type { Job, Script, Inventory, Research, ScriptReview, Transcript, NarrationReview } from './types';
import { event, invalidate, jobDir, readArtifact, saveJob, writeArtifact } from './store';
import { relevance } from '../pipeline/visual-utils';
import { pagesFor } from '../pipeline/document-map';

export const scriptText=(script:Script)=>script.text??script.segments.map(s=>s.text).join('\n\n');
export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const jsonDigest=(value:unknown)=>digest(JSON.stringify(value));
export async function fileDigest(id:string,file:string) {return digest(await readFile(path.join(jobDir(id),file)));}
const consistentText=(script:Script)=>scriptText(script).replace(/\s+/g,' ').trim()===script.segments.map(s=>s.text).join(' ').replace(/\s+/g,' ').trim();
export function scriptApproved(job:Job,script:Script) {
  return consistentText(script) && !!script.review && script.review.state==='approved' && job.scriptApproval?.version===script.review.version && job.scriptApproval.hash===digest(scriptText(script)) && script.review.hash===job.scriptApproval.hash;
}
export function audioApproved(job:Job,script:Script,transcript:Transcript) {
  const audio=job.narration;
  return scriptApproved(job,script) && audio?.state==='approved' && audio.scriptVersion===script.review!.version && audio.scriptHash===script.review!.hash && audio.transcriptHash===jsonDigest(transcript);
}
export async function persistScript(job:Job,script:Script,source:ScriptReview['source']) {
  const dir=path.join(jobDir(job.id),'script-versions');await mkdir(dir,{recursive:true});
  const old=await readArtifact<Script>(job.id,'script.json').catch(()=>null);
  // Archived files survive downstream invalidation; version numbers never reset.
  const history=await readArtifact<{latest:number}>(job.id,'script-history.json').catch(()=>({latest:0}));
  const version=Math.max(history.latest,old?.review?.version||0)+1;
  if(old?.review)await writeArtifact(job.id,`script-versions/${old.review.version}.json`,old);
  script.text=scriptText(script);script.review={version,source,state:source,createdAt:new Date().toISOString(),hash:digest(script.text)};
  await writeArtifact(job.id,`script-versions/${version}.json`,script);await writeArtifact(job.id,'script-history.json',{latest:version});await writeArtifact(job.id,'script.json',script);
  job.scriptApproval=undefined;return script;
}
export async function enterScriptReview(job:Job,script:Script) {
  if(!script.review)script=await persistScript(job,script,'generated');
  job.status='SCRIPT_REVIEW';event(job,'Review the VO script. Narration and final video generation are waiting for your approval.');await saveJob(job);return job;
}
function checkVersion(script:Script,version?:number) {
  if(!script.review || version!==script.review.version)throw new Error('The script changed. Reload its current version before saving or approving.');
}
export async function approveScript(job:Job,version?:number) {
  if(job.status!=='SCRIPT_REVIEW')throw new Error('Script approval is only available during script review');
  const script=await readArtifact<Script>(job.id,'script.json');checkVersion(script,version);
  if(!consistentText(script))throw new Error('Script segments no longer match the reviewed text. Save and review the script again.');
  const approvedAt=new Date().toISOString();script.review!.state='approved';script.review!.approvedAt=approvedAt;script.review!.hash=digest(scriptText(script));
  job.scriptApproval={version:script.review!.version,hash:script.review!.hash,approvedAt};
  await writeArtifact(job.id,'script.json',script);await writeArtifact(job.id,`script-versions/${version}.json`,script);
  if(job.narration?.hash && job.narration.scriptHash===script.review!.hash && job.narration.scriptVersion===version && await stat(path.join(jobDir(job.id),'narration.wav')).then(s=>s.size>0).catch(()=>false)) {
    job.narration.state='ready';job.status='AUDIO_REVIEW';
  }else job.status='NARRATION_PENDING';
  event(job,'Script approved. Choose generated TTS or upload your narration; video generation has not started.');await saveJob(job);return job;
}
export async function archiveAudio(job:Job) {
  if(!job.narration)return;
  const dir=path.join(jobDir(job.id),'audio-versions');await mkdir(dir,{recursive:true});
  await copyFile(path.join(jobDir(job.id),'narration.wav'),path.join(dir,`${job.narration.version}.wav`)).catch(()=>{});
  if(job.narration.inputFile)await copyFile(path.join(jobDir(job.id),job.narration.inputFile),path.join(dir,`${job.narration.version}-original${path.extname(job.narration.inputFile)}`)).catch(()=>{});
  await writeArtifact(job.id,`audio-versions/${job.narration.version}.json`,job.narration);
}
// Preserve the exact human text. Only visual associations are derived; no model rewrites it.
export function humanScript(text:string,source:ScriptReview['source'],previous:Script,inventory:Inventory,research:Research):Script {
  if(!text.trim())throw new Error('The narration script cannot be empty');
  const paragraphs=text.split(/\n\s*\n/).filter(s=>s.trim());
  const chunks=paragraphs.length>1?paragraphs:text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)\s*/g)||[text];
  const sections=pagesFor(inventory).flatMap(p=>p.sections).filter(s=>s.sceneId);let floor=0;
  const segments=chunks.map((chunk,index)=>{
    const candidates=sections.map((s,i)=>({s,i,score:relevance(chunk,s.heading+' '+s.text)})).filter(v=>v.i>=floor).sort((a,b)=>b.score-a.score||a.i-b.i);
    const chosen=index===0?{s:sections[0],i:0}:candidates[0];if(!chosen)throw new Error('No researched page section can support this script');floor=chosen.i;
    const scene=inventory.scenes.find(s=>s.id===chosen.s.sceneId)!;
    const claims=research.claims.filter(c=>c.sourceId===scene.sourceId && chosen.s.text.replace(/\s+/g,' ').includes(c.quote.replace(/\s+/g,' ')) && relevance(chunk,c.text+' '+c.quote)>0).slice(0,3).map(c=>c.id);
    return {id:`segment-${index+1}`,visitId:`human-visit-${index+1}`,sceneId:scene.id,sectionId:chosen.s.id,claimIds:claims,text:chunk};
  });
  return {...previous,text,segments,outline:undefined,mode:'extractive',review:undefined};
}
export async function saveScript(job:Job,text:string,source:'edited'|'user_provided',version?:number) {
  if(job.status!=='SCRIPT_REVIEW')throw new Error('Go back to script review before editing');
  const previous=await readArtifact<Script>(job.id,'script.json');checkVersion(previous,version);
  const inventory=await readArtifact<Inventory>(job.id,'inventory.json'),research=await readArtifact<Research>(job.id,'research.json');
  const script=humanScript(text,source,previous,inventory,research);
  await archiveAudio(job);await invalidate(job,'TTS');await persistScript(job,script,source);
  job.status='SCRIPT_REVIEW';event(job,'Script saved as a new version. Previous narration is stale; research and exploration are retained.');await saveJob(job);return job;
}
export async function backToScript(job:Job) {
  if(!['AUDIO_REVIEW','NARRATION_PENDING'].includes(job.status))throw new Error('Wait for narration processing to finish before returning to the script');
  const script=await readArtifact<Script>(job.id,'script.json');await invalidate(job,'DIRECTING');
  job.scriptApproval=undefined;if(script.review){script.review.state=script.review.source;script.review.approvedAt=undefined;}
  if(job.narration){job.narration.state='stale';job.narration.approvedAt=undefined;}
  await writeArtifact(job.id,'script.json',script);return enterScriptReview(job,script);
}
export async function prepareNarration(job:Job,source:NarrationReview['source']) {
  const script=await readArtifact<Script>(job.id,'script.json');if(!scriptApproved(job,script))throw new Error('Approve the current script before preparing narration');
  if(!['NARRATION_PENDING','AUDIO_REVIEW','FAILED'].includes(job.status))throw new Error('Wait for the current stage to finish');
  const version=(job.narration?.version||0)+1;await archiveAudio(job);await invalidate(job,'TTS');
  job.narration={version,source,state:'pending',scriptVersion:script.review!.version,scriptHash:script.review!.hash,createdAt:new Date().toISOString()};
  event(job,source==='generated'?'Generating narration from the approved script':'Aligning uploaded narration to the approved script');await saveJob(job);return job;
}
export async function approveAudio(job:Job,scriptVersion?:number,audioVersion?:number,proceed=false) {
  if(job.status!=='AUDIO_REVIEW')throw new Error('Audio approval is only available during audio review');
  const script=await readArtifact<Script>(job.id,'script.json');checkVersion(script,scriptVersion);
  const audio=job.narration;if(!scriptApproved(job,script) || !audio || audio.state!=='ready' || audio.version!==audioVersion || audio.scriptVersion!==scriptVersion || audio.scriptHash!==script.review!.hash)throw new Error('Narration is stale or changed. Regenerate or replace it before approving.');
  if(audio.mismatch?.significant && !proceed && audio.mismatchResolution!=='transcript')throw new Error('The uploaded narration differs from the approved script. Resolve the mismatch or explicitly proceed anyway.');
  if(audio.hash!==await fileDigest(job.id,'narration.wav'))throw new Error('The narration file changed. Replace and review it again.');
  const transcript=await readArtifact<Transcript>(job.id,'transcript.json');if(!transcript.words.length || !(transcript.duration>0))throw new Error('Real narration timestamps are required before video generation');
  if(audio.transcriptHash!==jsonDigest(transcript))throw new Error('Narration timing changed. Review the audio again.');
  audio.state='approved';audio.approvedAt=new Date().toISOString();if(proceed)audio.mismatchResolution='proceed';
  job.status='RECEIVED';job.revision++;event(job,'Audio approved. Planning and generating the video using its real timestamps.');await saveJob(job);return job;
}
export async function adoptAudioTranscript(job:Job) {
  if(job.status!=='AUDIO_REVIEW' || job.narration?.source!=='uploaded')throw new Error('An uploaded audio review is required');
  const audio={...job.narration},recognized=await readArtifact<import('../pipeline/narration').RecognizedSpeech>(job.id,'audio-transcription.json');
  const old=await readArtifact<Script>(job.id,'script.json'),inventory=await readArtifact<Inventory>(job.id,'inventory.json'),research=await readArtifact<Research>(job.id,'research.json');
  const text=recognized.words.map(w=>w.text).join(' '),script=humanScript(text,'user_provided',old,inventory,research);
  await archiveAudio(job);await invalidate(job,'DIRECTING');await persistScript(job,script,'user_provided');
  const {alignNarration}=await import('../pipeline/narration');const aligned=alignNarration(script,recognized,audio.duration!);
  await writeArtifact(job.id,'transcript.json',aligned.transcript);
  job.narration={...audio,version:audio.version+1,state:'stale',scriptVersion:script.review!.version,scriptHash:script.review!.hash,approvedAt:undefined,mismatch:aligned.mismatch,mismatchResolution:'transcript',transcriptHash:jsonDigest(aligned.transcript)};
  return enterScriptReview(job,script);
}
