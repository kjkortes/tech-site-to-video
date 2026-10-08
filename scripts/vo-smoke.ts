// Real configured-model integration test. Stops at script review; no TTS/video.
import assert from 'node:assert/strict';
import path from 'node:path';
import {cp,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {config} from '../src/lib/config';
import {createJob,getJob,saveJob,jobDir,writeArtifact,readArtifact,invalidate} from '../src/lib/store';
import {runPipeline} from '../src/pipeline';
import {captureMode,captureRevision,viewport} from '../src/pipeline/browser';
import {directorRevision} from '../src/pipeline/direct';
import {mapRevision} from '../src/pipeline/document-map';
import {wordCount,inspectScriptQuality} from '../src/pipeline/script-quality';
import type {Script,Job,Inventory,Research} from '../src/lib/types';
const source=path.resolve(process.argv[2]||'data/jobs/48a0ea00-9b36-40b7-8633-0806b481fc5e');
const sourceJob=JSON.parse(await readFile(path.join(source,'job.json'),'utf8')) as Job;
const old=JSON.parse(await readFile(path.join(source,'script.json'),'utf8')) as Script;
config.dataDir=path.resolve('test-output/vo-scripts');config.database='';config.redis='';config.explorePages=1;
const resumeIds=(process.env.VO_RESUME_JOBS||'').split(',').filter(Boolean);
await mkdir(config.dataDir,{recursive:true});const results:{id:string;title:string;old?:string;script:Script;research:Research}[]=[];
const urls=process.argv[3]? [sourceJob.url,process.argv[3]]:[sourceJob.url,'https://github.com/localsend/localsend'];
for(let i=0;i<urls.length;i++) {
 const job=resumeIds[i]?await getJob(resumeIds[i]):await createJob(urls[i]);assert.ok(job,'Missing resume test job');job.llm=sourceJob.llm;
 if(resumeIds[i]){assert.ok(path.resolve(jobDir(job.id)).startsWith(config.dataDir+path.sep),'Resume isolated fixtures only');assert.equal(job.url,urls[i]);if(job.status==='SCRIPT_REVIEW'&&(i===0||process.env.VO_KEEP_SECOND!=='true'))await invalidate(job,'SCRIPTING');}
 if(i===0&&!resumeIds[i]){for(const file of ['research.json','inventory.json','assets','exploration'])await cp(path.join(source,file),path.join(jobDir(job.id),file),{recursive:true});job.completed=['RESEARCHING','EXPLORING'];const inventory=await readArtifact<Inventory>(job.id,'inventory.json');Object.assign(inventory,{captureMode,captureRevision,captureViewport:viewport,directorRevision,mapRevision});await writeArtifact(job.id,'inventory.json',inventory);await writeArtifact(job.id,'script-versions/1.json',old);await writeArtifact(job.id,'script-history.json',{latest:1});job.scriptFeedback='Make the hook stronger, group related features, less technical. Save the most unusual differentiator for later.';}
 if(process.env.VO_FEEDBACK&&i===0)job.scriptFeedback=process.env.VO_FEEDBACK;
 await saveJob(job);console.log(`VO integration ${i+1}: ${job.id} · ${urls[i]} · ${JSON.stringify(job.llm)}`);
 const timer=setInterval(async()=>{const state=await getJob(job.id);console.log(`${state?.status}: ${state?.detail}`);},10000);
 try{await runPipeline(job.id);}finally{clearInterval(timer);}
 const done=(await getJob(job.id))!;assert.equal(done.status,'SCRIPT_REVIEW',done.error);
 assert.equal(await stat(path.join(jobDir(job.id),'narration.wav')).then(()=>true).catch(()=>false),false,'TTS must not run before approval');assert.equal(await stat(path.join(jobDir(job.id),'shot-plan.json')).then(()=>true).catch(()=>false),false);
 const script=await readArtifact<Script>(job.id,'script.json'),research=await readArtifact<Research>(job.id,'research.json'),inventory=await readArtifact<Inventory>(job.id,'inventory.json');
 assert.ok(script.quality);assert.ok(script.quality.candidates.some(c=>c.id===script.quality!.selectedCandidate&&c.supported));
 console.log(JSON.stringify({job:job.id,script:script.text,quality:script.quality,heuristics:inspectScriptQuality(script,inventory,script.outline!)},null,2));results.push({id:job.id,title:script.title,old:i===0?old.text||old.segments.map(s=>s.text).join('\n\n'):undefined,script,research});
}
await writeArtifact(results[0].id,'comparison.json',results);
const markdown=results.map(r=>`# ${r.title}\n\n${r.old?'## Previous script\n\n'+r.old+'\n\n':''}## New script (${wordCount(r.script.text!)} words)\n\n${r.script.text}\n\n## Review\n\n${JSON.stringify(r.script.quality,null,2)}\n\nSource: ${r.research.sources[0].url}\n\nJob: ${r.id}`).join('\n\n---\n\n');await writeFile(path.join(config.dataDir,'comparison.md'),markdown);console.log('PASS: source-grounded scripts for two repositories, real model and attached visuals, quality review, no TTS or video. '+path.join(config.dataDir,'comparison.md'));
