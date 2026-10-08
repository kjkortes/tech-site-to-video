import assert from 'node:assert/strict';
import path from 'node:path';
import { config } from '../src/lib/config';
import { createJob, getJob, jobDir, readArtifact, saveJob, invalidate } from '../src/lib/store';
import { runPipeline } from '../src/pipeline';
import { Inventory, Shot, DiversityReport, QAReport } from '../src/lib/types';

config.dataDir = path.resolve('test-output/director-smoke');
const job = process.env.DIRECTOR_RESUME_ID ? await getJob(process.env.DIRECTOR_RESUME_ID) : await createJob(process.argv[2] || 'https://github.com/storytold/photocraft');
if (!job) throw new Error('Resume job not found');
if (process.env.DIRECTOR_REPLAN === 'true') await invalidate(job, 'DIRECTING');
if (job.status === 'FAILED') { job.status = 'RECEIVED'; job.error = undefined; await saveJob(job); }
console.log(`Director integration job: ${job.id}`);
const timer = setInterval(async()=>{const j=await getJob(job.id);console.log(`${j?.status}: ${j?.detail}`);},10000);
try { await runPipeline(job.id); } finally { clearInterval(timer); }
const done=await getJob(job.id); assert.equal(done?.status,'READY_FOR_REVIEW',done?.error);
const inventory=await readArtifact<Inventory>(job.id,'inventory.json');
const shots=await readArtifact<Shot[]>(job.id,'shot-plan.json');
const diversity=await readArtifact<DiversityReport>(job.id,'diversity.json');
const qa=await readArtifact<QAReport>(job.id,'qa.json');
assert.ok(diversity.passed && qa.passed);
assert.ok(shots.every(s=>s.duration<=4.5));
if (inventory.assets?.some(a=>a.type==='image')) assert.ok(shots.some(s=>s.type==='media_fullscreen' || s.type==='zoom_region'));
console.log(JSON.stringify({ assets:inventory.assets?.length,shots:shots.length,flow:shots.map(s=>`${s.type}:${s.assetId}`),diversity,qa:qa.score,mp4:path.join(jobDir(job.id),'final.mp4')},null,2));
