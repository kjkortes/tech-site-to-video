import {approvedTestPipeline} from './approval-test-driver';
// Reuse verified source research in an isolated job; refresh captures and create a new story/voice/plan.
import path from 'node:path';
import { cp } from 'node:fs/promises';
import { config } from '../src/lib/config';
import { createJob,jobDir,saveJob,readArtifact } from '../src/lib/store';
import { runPipeline } from '../src/pipeline';
import type { Inventory,Research,CoverageReport,QAReport,Shot,Transcript } from '../src/lib/types';
import assert from 'node:assert/strict';
config.dataDir=path.resolve('test-output/director-smoke');config.database='';
const source=process.argv[2]||'dab9bcfb-135d-4159-b6e9-b01fc24ec5f2';
const job=await createJob('https://github.com/storytold/photocraft',{model:'gpt-6-sol',effort:'high',creativity:'balanced'});
job.llm!.provider='codex';
for(const name of ['research.json','inventory.json','assets','exploration'])await cp(path.join(jobDir(source),name),path.join(jobDir(job.id),name),{recursive:true});
job.completed=['RESEARCHING','EXPLORING'];await saveJob(job);
console.log(`Presentation job: ${job.id}`);
const timer=setInterval(async()=>{const {getJob}=await import('../src/lib/store');const state=await getJob(job.id);console.log(`${state?.status}: ${state?.detail}`);},10000);
try{await approvedTestPipeline(job.id);}finally{clearInterval(timer);}
const {getJob}=await import('../src/lib/store');const done=await getJob(job.id);assert.equal(done?.status,'READY_FOR_REVIEW',done?.error);
const inventory=await readArtifact<Inventory>(job.id,'inventory.json'),research=await readArtifact<Research>(job.id,'research.json');
const coverage=await readArtifact<CoverageReport>(job.id,'coverage-report.json'),qa=await readArtifact<QAReport>(job.id,'qa.json'),shots=await readArtifact<Shot[]>(job.id,'shot-plan.json'),transcript=await readArtifact<Transcript>(job.id,'transcript.json');
assert.ok(coverage.passed && qa.passed);assert.ok(shots.every(s=>s.captionPosition==='bottom-center'));assert.ok(inventory.assets?.some(a=>a.code?.lines.length));
console.log(JSON.stringify({product:research.title,duration:transcript.duration,visualGroups:coverage.groups.map(g=>({source:g.assetId,spoken:[g.transcriptStart,g.transcriptEnd],visible:[g.visualStart,g.visualEnd],text:g.supportedText})),warnings:qa.checks.filter(c=>!c.passed),flow:shots.map(s=>`${s.walkthrough?.location.heading}: ${s.walkthrough?.role} ${s.type} ${s.duration.toFixed(2)}s`),qaScore:qa.score,mp4:path.join(jobDir(job.id),'final.mp4')},null,2));
