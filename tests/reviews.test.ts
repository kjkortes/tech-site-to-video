import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm,readFile,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {config} from '../src/lib/config';
import {createJob,getJob,saveJob,writeArtifact,readArtifact,jobDir} from '../src/lib/store';
import {persistScript,approveScript,saveScript,backToScript,prepareNarration,approveAudio,scriptApproved,audioApproved,fileDigest,jsonDigest,adoptAudioTranscript} from '../src/lib/reviews';
import {runnable} from '../src/lib/workflow';
import {runPipeline} from '../src/pipeline';
import {captureRevision,captureMode,viewport} from '../src/pipeline/browser';
import {directorRevision} from '../src/pipeline/direct';
import {mapRevision} from '../src/pipeline/document-map';
import {fallbackEditorial} from '../src/pipeline/editorial';
import {storyRevision} from '../src/pipeline/story';
import {alignNarration,prepareUploadedSpeech} from '../src/pipeline/narration';
import {run} from '../src/lib/process';
import {POST as actionPost} from '../src/app/api/jobs/[id]/actions/route';
import {POST as uploadPost} from '../src/app/api/jobs/[id]/narration/route';
import type {Script,Inventory,Research,Job} from '../src/lib/types';
const model={provider:'extractive' as const,model:'',effort:'default' as const,creativity:'balanced' as const};
const descriptions=['Editor is an offline image editor.','Layers and masks preserve original pixels.','Editor is in early alpha.'];
const sections=descriptions.map((text,i)=>({id:`section-${i}`,pageId:'page-1',sourceId:'source-1',heading:['Editor','Features','Status'][i],order:i,selector:`#section-${i}`,scrollY:i*500,endY:(i+1)*500,text,assetIds:[],sceneId:`scene-${i}`}));
const inventory:Inventory={contentMode:'promotional',sourceUrl:'https://example.com/',sourceType:'website',captureRevision,captureMode,captureViewport:viewport,directorRevision,mapRevision,notes:[],pages:[{id:'page-1',sourceId:'source-1',url:'https://example.com/',title:'Editor',order:0,sections}],scenes:sections.map(s=>({id:s.sceneId,url:'https://example.com/',title:s.heading,description:s.text,sourceId:s.sourceId,sectionId:s.id,actions:[],screenshot:`exploration/${s.sceneId}.png`})),assets:[]};
const research:Research={title:'Editor',description:'',mode:'extractive',sources:[{id:'source-1',url:'https://example.com/',title:'Editor',text:descriptions.join(' ')}],claims:descriptions.map((text,i)=>({id:`c${i}`,sourceId:'source-1',text,quote:text}))};
research.editorial=fallbackEditorial(research);
const base:Script={title:'Editor',mode:'extractive',revision:storyRevision,segments:sections.map((s,i)=>({id:`segment-${i}`,sceneId:s.sceneId,sectionId:s.id,visitId:`visit-${i}`,text:i===0?'This is Editor, an offline image editor.':s.text,claimIds:[`c${i}`]}))};
async function isolated(work:()=>Promise<void>){const previous=config.dataDir;config.dataDir=await mkdtemp(path.join(tmpdir(),'video-approvals-'));try{await work();}finally{await rm(config.dataDir,{recursive:true,force:true});config.dataDir=previous;}}
async function seed(){const job=await createJob('https://example.com/');job.llm=model;await writeArtifact(job.id,'research.json',research);await writeArtifact(job.id,'inventory.json',inventory);const script=await persistScript(job,structuredClone(base),'generated');job.completed=['RESEARCHING','EXPLORING','SCRIPTING'];await saveJob(job);return {job,script};}
const context=(id:string)=>({params:Promise.resolve({id})});
const action=(id:string,input:object)=>actionPost(new Request('http://localhost:3000/api/jobs/actions',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:3000'},body:JSON.stringify(input)}),context(id));
async function audioReady(job:Job,script:Script,mismatched=false){await prepareNarration(job,'uploaded');await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=300:duration=15','-ar','48000',path.join(jobDir(job.id),'narration.wav')]);const text=mismatched?'Bananas grow near tropical rivers and the weather changes every morning.':script.text!;const words=text.trim().split(/\s+/).map((text,i)=>({text,start:i*.45,end:i*.45+.4}));const recognized={duration:15,words,segments:[]};const aligned=alignNarration(script,recognized,15);await writeArtifact(job.id,'audio-transcription.json',recognized);await writeArtifact(job.id,'transcript.json',aligned.transcript);Object.assign(job.narration!,{state:'ready',duration:15,hash:await fileDigest(job.id,'narration.wav'),transcriptHash:jsonDigest(aligned.transcript),mismatch:aligned.mismatch});job.completed.push('TTS');job.status='AUDIO_REVIEW';await saveJob(job);return aligned.transcript;}

test('worker and backend stop at both durable approval gates, including replayed queue messages',()=>isolated(async()=>{
 const {job}=await seed();await runPipeline(job.id);const waiting=(await getJob(job.id))!;assert.equal(waiting.status,'SCRIPT_REVIEW');assert.equal(runnable(waiting),false);assert.equal(await stat(path.join(jobDir(job.id),'transcript.json')).then(()=>true).catch(()=>false),false);
 await runPipeline(job.id);assert.equal((await getJob(job.id))!.status,'SCRIPT_REVIEW');
 assert.equal((await action(job.id,{action:'generate-tts'})).status,409);assert.equal((await action(job.id,{action:'approve-audio',scriptVersion:1,audioVersion:1})).status,409);
 assert.equal((await action(job.id,{action:'approve-script',scriptVersion:99})).status,409);
 assert.equal((await action(job.id,{action:'approve-script',scriptVersion:1})).status,200);const approved=(await getJob(job.id))!;assert.equal(approved.status,'NARRATION_PENDING');await runPipeline(job.id);assert.equal((await getJob(job.id))!.status,'NARRATION_PENDING');
 const script=await readArtifact<Script>(job.id,'script.json');const speech=await audioReady(approved,script);await runPipeline(job.id);assert.equal((await getJob(job.id))!.status,'AUDIO_REVIEW');assert.equal(await stat(path.join(jobDir(job.id),'shot-plan.json')).then(()=>true).catch(()=>false),false);
 assert.equal((await action(job.id,{action:'approve-audio',scriptVersion:1,audioVersion:approved.narration!.version})).status,200);assert.ok(audioApproved((await getJob(job.id))!,script,speech));assert.ok(runnable((await getJob(job.id))!));
}));

test('regeneration, exact human text, version history and dependency invalidation retain research/exploration',()=>isolated(async()=>{
 const {job}=await seed();await runPipeline(job.id);const researchBefore=await readFile(path.join(jobDir(job.id),'research.json'),'utf8'),inventoryBefore=await readFile(path.join(jobDir(job.id),'inventory.json'),'utf8');
 assert.equal((await action(job.id,{action:'regenerate-script',feedback:'Make it shorter',scriptVersion:1})).status,200);await runPipeline(job.id);let current=(await getJob(job.id))!;let script=await readArtifact<Script>(job.id,'script.json');assert.equal(current.status,'SCRIPT_REVIEW');assert.equal(script.review!.version,2);assert.equal(current.scriptFeedback,'Make it shorter');assert.equal(await readFile(path.join(jobDir(job.id),'research.json'),'utf8'),researchBefore);
 const exact='My own opening: Editor edits images.\n\nLayers and masks preserve original pixels.\n\nIt is still early alpha.\n';await saveScript(current,exact,'user_provided',2);script=await readArtifact<Script>(job.id,'script.json');assert.equal(script.text,exact);assert.equal(script.review!.source,'user_provided');assert.equal(script.review!.version,3);assert.equal((await readArtifact<Script>(job.id,'script-versions/1.json')).review!.source,'generated');
 await approveScript(current,3);assert.ok(scriptApproved(current,await readArtifact<Script>(job.id,'script.json')));script=await readArtifact<Script>(job.id,'script.json');await audioReady(current,script);await backToScript(current);assert.equal(current.narration!.state,'stale');await saveScript(current,exact.replace('Layers','Non-destructive layers'),'edited',3);assert.equal(current.narration!.state,'stale');assert.equal(current.scriptApproval,undefined);assert.equal(await stat(path.join(jobDir(job.id),'narration.wav')).then(()=>true).catch(()=>false),false);await approveScript(current,4);assert.equal(current.status,'NARRATION_PENDING');await assert.rejects(()=>approveAudio(current,3,current.narration!.version),/Audio approval/);
 assert.equal(await readFile(path.join(jobDir(job.id),'research.json'),'utf8'),researchBefore);const after=await readArtifact<Inventory>(job.id,'inventory.json');assert.deepEqual(after.scenes,JSON.parse(inventoryBefore).scenes);assert.ok(await stat(path.join(jobDir(job.id),'audio-versions/1.wav')));
}));

test('significant narration mismatch blocks approval; explicit proceed and transcript adoption require reviewed versions',()=>isolated(async()=>{
 const {job}=await seed();job.status='SCRIPT_REVIEW';await saveJob(job);await approveScript(job,1);const script=await readArtifact<Script>(job.id,'script.json');await audioReady(job,script,true);assert.ok(job.narration!.mismatch!.significant);await assert.rejects(()=>approveAudio(job,1,1),/differs/);await approveAudio(job,1,1,true);assert.equal(job.narration!.mismatchResolution,'proceed');
 job.status='AUDIO_REVIEW';job.narration!.state='ready';await saveJob(job);await adoptAudioTranscript(job);assert.equal(job.status,'SCRIPT_REVIEW');const adopted=await readArtifact<Script>(job.id,'script.json');assert.equal(adopted.text,job.narration!.mismatch!.transcript);assert.equal(adopted.review!.version,2);assert.equal(job.narration!.state,'stale');await approveScript(job,2);assert.equal(job.status,'AUDIO_REVIEW');await approveAudio(job,2,2);assert.equal(job.status,'RECEIVED');
}));

test('writing review is versioned and survives approval, but human edits remove obsolete scores',()=>isolated(async()=>{
 const {job,script}=await seed();
 script.quality={revision:1,status:'checked',selectedCandidate:'chosen',wordCount:30,revised:false,issues:[],notes:[],candidates:[],inspectedAssetIds:['source-image']};
 const generated=await persistScript(job,script,'generated');job.status='SCRIPT_REVIEW';await saveJob(job);
 assert.equal((await readArtifact<{scriptVersion:number}>(job.id,'script-quality.json')).scriptVersion,generated.review!.version);
 await approveScript(job,generated.review!.version);assert.equal((await readArtifact<Script>(job.id,'script.json')).quality!.selectedCandidate,'chosen');
 await backToScript(job);await saveScript(job,'My own exact words.','edited',generated.review!.version);
 assert.equal((await readArtifact<Script>(job.id,'script.json')).quality,undefined);
 assert.equal(await stat(path.join(jobDir(job.id),'script-quality.json')).then(()=>true).catch(()=>false),false);
 assert.equal((await readArtifact<Script>(job.id,`script-versions/${generated.review!.version}.json`)).quality!.selectedCandidate,'chosen');
 assert.equal(job.status,'SCRIPT_REVIEW');assert.equal(job.scriptApproval,undefined);
}));

test('alignment uses actual speech timestamps, tolerates punctuation and rejects invented/invalid timing',()=>{
 const script={...base,text:'Layers preserve pixels. Masks protect regions.',segments:[{...base.segments[0],text:'Layers preserve pixels.'},{...base.segments[1],text:'Masks protect regions.'}]};const words=['layers','preserve','pixels','masks','protect','regions'].map((text,i)=>({text,start:1+i*.6,end:1.4+i*.6}));const aligned=alignNarration(script,{duration:7,words,segments:[]},7);assert.equal(aligned.mismatch.significant,false);assert.equal(aligned.transcript.duration,7);assert.equal(aligned.transcript.segments[0].start,1);assert.equal(aligned.transcript.segments[1].start,2.8);assert.deepEqual(aligned.transcript.words,words);assert.throws(()=>alignNarration(script,{duration:7,words:[],segments:[]},7),/no real/);assert.throws(()=>alignNarration(script,{duration:7,words:[{text:'Layers',start:0,end:99}],segments:[]},7),/invalid/);
});

test('WAV, MP3 and M4A uploads are persisted, probed and aligned without TTS; unapproved uploads rejected',()=>isolated(async()=>{
 const {job}=await seed();await runPipeline(job.id);const fixture=path.join(jobDir(job.id),'fixture.wav');await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=300:duration=5','-ar','24000',fixture]);
 async function upload(file:string){const form=new FormData();form.set('audio',new File([await readFile(file)],path.basename(file)));form.set('scriptVersion','1');return uploadPost(new Request('http://localhost:3000/api/jobs/narration',{method:'POST',headers:{Origin:'http://localhost:3000'},body:form}),context(job.id));}
 assert.equal((await upload(fixture)).status,409);let current=(await getJob(job.id))!;await approveScript(current,1);
 for(const extension of ['wav','mp3','m4a']) {
  const file=path.join(jobDir(job.id),`fixture.${extension}`);if(extension!=='wav')await run('ffmpeg',['-v','error','-y','-i',fixture,file]);assert.equal((await upload(file)).status,202);current=(await getJob(job.id))!;assert.equal(current.narration!.source,'uploaded');assert.equal(current.narration!.format,extension==='wav'?'pcm_s16le':extension==='mp3'?'mp3':'aac');assert.equal(current.narration!.sampleRate,24000);assert.ok(current.narration!.duration!>=5);
  const script=await readArtifact<Script>(job.id,'script.json');const words=script.text!.trim().split(/\s+/).map((text,i)=>({text,start:i*.15,end:i*.15+.13}));await writeArtifact(job.id,'audio-transcription.json',{duration:5,words,segments:[]});const aligned=await prepareUploadedSpeech(current,script);assert.equal(aligned.timingSource,'local-whisper-word-alignment');assert.ok(Math.abs(aligned.duration-5)<.1);assert.ok(!current.narration!.mismatch!.significant);current.status='AUDIO_REVIEW';current.narration!.state='ready';await saveJob(current);
 }
}));

test('approval cannot be reused after script text, segment text, waveform or timing changes',()=>isolated(async()=>{
 const {job}=await seed();job.status='SCRIPT_REVIEW';await saveJob(job);await approveScript(job,1);const script=await readArtifact<Script>(job.id,'script.json');const tampered=structuredClone(script);tampered.segments[0].text='Changed hidden narration';assert.equal(scriptApproved(job,tampered),false);await audioReady(job,script);const speech=await readArtifact(job.id,'transcript.json');await writeArtifact(job.id,'transcript.json',{...speech as object,duration:99});await assert.rejects(()=>approveAudio(job,1,1),/timing changed/);const changed=structuredClone(script);changed.text+=' New unapproved words.';assert.equal(scriptApproved(job,changed),false);await writeArtifact(job.id,'transcript.json',speech);await writeFile(path.join(jobDir(job.id),'narration.wav'),Buffer.from('changed waveform'));await assert.rejects(()=>approveAudio(job,1,1),/narration file changed/);
}));

test('a missing narration checkpoint preserves the upload, revokes audio approval and stops for fresh review',()=>isolated(async()=>{
 const {job}=await seed();job.status='SCRIPT_REVIEW';await saveJob(job);await approveScript(job,1);const script=await readArtifact<Script>(job.id,'script.json');const speech=await audioReady(job,script);const fs=await import('node:fs/promises');await fs.copyFile(path.join(jobDir(job.id),'narration.wav'),path.join(jobDir(job.id),'audio-input.wav'));job.narration!.inputFile='audio-input.wav';await approveAudio(job,1,1);await fs.rm(path.join(jobDir(job.id),'narration.wav'));await runPipeline(job.id);const repaired=(await getJob(job.id))!;assert.equal(repaired.status,'AUDIO_REVIEW',repaired.error);assert.equal(repaired.narration!.version,2);assert.equal(repaired.narration!.state,'ready');assert.ok(await stat(path.join(jobDir(job.id),'audio-input.wav')));assert.equal(await stat(path.join(jobDir(job.id),'shot-plan.json')).then(()=>true).catch(()=>false),false);assert.equal(repaired.narration!.duration,speech.duration);
}));

test('a user script survives map/story migration with its exact text and script approval retained',()=>isolated(async()=>{
 const {job}=await seed();await runPipeline(job.id);const current=(await getJob(job.id))!;await saveScript(current,'My editor walkthrough.\n\nLayers and masks preserve original pixels.','user_provided',1);await approveScript(current,2);let script=await readArtifact<Script>(job.id,'script.json');const exact=script.text;script.revision=0;await writeArtifact(job.id,'script.json',script);current.status='RECEIVED';await saveJob(current);await runPipeline(job.id);script=await readArtifact<Script>(job.id,'script.json');assert.equal(script.text,exact);assert.equal(script.review!.version,2);assert.equal(script.revision,storyRevision);assert.equal((await getJob(job.id))!.status,'NARRATION_PENDING');assert.equal(script.review!.source,'user_provided');
}));
