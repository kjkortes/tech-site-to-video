// Reuse captured research/media in isolated jobs. Exercise real editorial,
// planner, writer, critic, regeneration, and the existing SCRIPT_REVIEW gate.
import assert from 'node:assert/strict';
import path from 'node:path';
import {cp,readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {config} from '../src/lib/config';
import {createJob,saveJob,getJob,jobDir,writeArtifact,readArtifact} from '../src/lib/store';
import {runPipeline} from '../src/pipeline';
import {captureMode,captureRevision,viewport} from '../src/pipeline/browser';
import {directorRevision} from '../src/pipeline/direct';
import {mapRevision} from '../src/pipeline/document-map';
import {wordCount} from '../src/pipeline/script-quality';
import {promotionalClaim} from '../src/pipeline/audience-value';
import type {Job,Research,Script,Inventory} from '../src/lib/types';
const sources=process.argv.slice(2);
if(!sources.length)sources.push('data/jobs/7d081e19-82f3-438b-82a2-668c5aa5efae','test-output/vo-scripts/jobs/444245bc-3d1d-4418-bbac-d0ba3abb9e56');
config.dataDir=path.resolve(process.env.EDITORIAL_OUTPUT_DIR||'test-output/editorial');config.database='';config.redis='';
await mkdir(config.dataDir,{recursive:true});
const comparisons=[];
for(const source of sources) {
 const sourceJob=JSON.parse(await readFile(path.join(source,'job.json'),'utf8')) as Job;
 const baseline=process.env.EDITORIAL_BASELINES?.split(',')[comparisons.length];
 const old=JSON.parse(await readFile(baseline||path.join(source,'script.json'),'utf8')) as Script;
 const job=await createJob(sourceJob.url);job.llm=sourceJob.llm;job.contentMode='promotional';job.completed=['RESEARCHING','EXPLORING'];
 for(const file of ['research.json','inventory.json','assets','exploration'])await cp(path.join(source,file),path.join(jobDir(job.id),file),{recursive:true});
 const inventory=await readArtifact<Inventory>(job.id,'inventory.json');Object.assign(inventory,{captureMode,captureRevision,captureViewport:viewport,directorRevision,mapRevision});await writeArtifact(job.id,'inventory.json',inventory);
 await writeArtifact(job.id,'script-versions/1.json',old);await writeArtifact(job.id,'script-history.json',{latest:1});
 job.scriptFeedback=process.env.EDITORIAL_FEEDBACK||'You missed the point. Focus on the project’s main purpose and strongest compatibility/workflow evidence. De-emphasize secondary automation.';
 await saveJob(job);console.log(`Generating ${old.title} in isolated job ${job.id}`);
 await runPipeline(job.id);
 const done=(await getJob(job.id))!;assert.equal(done.status,'SCRIPT_REVIEW',done.error);
 for(const file of ['narration.wav','shot-plan.json'])assert.equal(await stat(path.join(jobDir(job.id),file)).then(()=>true).catch(()=>false),false);
 const script=await readArtifact<Script>(job.id,'script.json'),research=await readArtifact<Research>(job.id,'research.json');
 assert.ok(research.editorial);assert.ok(script.quality);assert.ok(script.quality.dimensions!.thesisFidelity>=4,JSON.stringify(script.quality));
 assert.ok(script.quality.dimensions!.audienceValue>=4,JSON.stringify(script.quality));
 assert.ok(script.segments.flatMap(s=>s.claimIds).every(id=>promotionalClaim(research.editorial!.claims.find(c=>c.claimId===id)!)),'Promotional facts must earn audience runtime');
 assert.equal(script.quality.issues.some(i=>['audience-value','audience-proof','technical-density','weak-takeaway'].includes(i.code)),false,JSON.stringify(script.quality.issues));
 assert.ok(script.segments.length<=5);
 if(research.editorial.claims.some(c=>c.category==='CAVEAT' && c.thesisContribution>=3))assert.ok(script.outline!.visits.some(v=>v.storyRole==='caveat'),'Important caveat must remain narratable');assert.equal(script.outline!.visits.some(v=>v.storyRole==='surprise'),false);
 console.log(JSON.stringify({title:script.title,script:script.text,words:wordCount(script.text!),dimensions:script.quality.dimensions,status:script.quality.status,visits:script.outline!.visits.map(v=>v.purpose)},null,2));
 comparisons.push({jobId:job.id,title:script.title,old:old.text||old.segments.map(s=>s.text).join('\n\n'),new:script.text,editorial:research.editorial,quality:script.quality});
}
await writeFile(path.join(config.dataDir,'comparison.json'),JSON.stringify(comparisons,null,2));
await writeFile(path.join(config.dataDir,'comparison.md'),comparisons.map(c=>`# ${c.title}\n\n## Old VO\n\n${c.old}\n\n## New VO\n\n${c.new}\n\nThesis fidelity: ${c.quality!.dimensions!.thesisFidelity}/5. Audience value: ${c.quality!.dimensions!.audienceValue}/5. Job: ${c.jobId}. Stopped at SCRIPT_REVIEW.\n`).join('\n'));
console.log(`PASS: audience-valued thesis-led VO and human review gate. ${path.join(config.dataDir,'comparison.md')}`);
