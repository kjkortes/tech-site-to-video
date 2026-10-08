import {approvedTestPipeline} from './approval-test-driver';
import assert from 'node:assert/strict';
import path from 'node:path';
import { config } from '../src/lib/config';
import { createJob, getJob, jobDir, readArtifact, saveJob, invalidate } from '../src/lib/store';
import { runPipeline } from '../src/pipeline';
import { CoverageReport, Inventory, Shot, DiversityReport, QAReport, ContinuityReport, StoryOutline } from '../src/lib/types';

config.dataDir = path.resolve('test-output/director-smoke');
const job = process.env.DIRECTOR_RESUME_ID ? await getJob(process.env.DIRECTOR_RESUME_ID) : await createJob(process.argv[2] || 'https://github.com/storytold/photocraft');
if (!job) throw new Error('Resume job not found');
if (process.env.DIRECTOR_REPLAN === 'true') await invalidate(job, 'DIRECTING');
if (job.status === 'FAILED') { job.status = 'RECEIVED'; job.error = undefined; await saveJob(job); }
console.log(`Director integration job: ${job.id}`);
const timer = setInterval(async()=>{const j=await getJob(job.id);console.log(`${j?.status}: ${j?.detail}`);},10000);
try { await approvedTestPipeline(job.id,{regenerate:process.env.SMOKE_REGENERATE==='true'}); } finally { clearInterval(timer); }
const done=await getJob(job.id); assert.equal(done?.status,'READY_FOR_REVIEW',done?.error);
const inventory=await readArtifact<Inventory>(job.id,'inventory.json');
const shots=await readArtifact<Shot[]>(job.id,'shot-plan.json');
const diversity=await readArtifact<DiversityReport>(job.id,'diversity.json');
const qa=await readArtifact<QAReport>(job.id,'qa.json');
const continuity=await readArtifact<ContinuityReport>(job.id,'walkthrough-report.json');
const outline=await readArtifact<StoryOutline>(job.id,'story-outline.json');
const state=await readArtifact<{shotId:string}[]>(job.id,'walkthrough-state.json');
assert.ok(diversity.passed && qa.passed);
assert.ok(continuity.passed,JSON.stringify(continuity.issues));
assert.ok(outline.visits.length && inventory.pages?.length);
assert.equal(state.length,shots.length);
const coverage=await readArtifact<CoverageReport>(job.id,'coverage-report.json');assert.ok(coverage.passed,JSON.stringify(coverage.issues));
assert.ok(shots.every(s=>s.captionPosition==='bottom-center'));
assert.ok(coverage.groups.every(g=>g.visualStart<=g.transcriptStart && g.visualEnd>=g.transcriptEnd-.025));
if (inventory.assets?.some(a=>a.type==='image')) assert.ok(shots.some(s=>s.type==='media_fullscreen' || s.type==='zoom_region'));
console.log(JSON.stringify({ assets:inventory.assets?.length,shots:shots.length,flow:shots.map(s=>`${s.walkthrough?.location.heading} → ${s.walkthrough?.role}: ${s.type}:${s.assetId}`),continuity,diversity,qa:qa.score,mp4:path.join(jobDir(job.id),'final.mp4')},null,2));
