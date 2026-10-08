import {approvedTestPipeline} from './approval-test-driver';
import http from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stat,readFile } from 'node:fs/promises';
import { config } from '../src/lib/config';
import { createJob, getJob, jobDir, readArtifact, saveJob } from '../src/lib/store';
import { runPipeline } from '../src/pipeline';
import { probe } from '../src/lib/process';
import { QAReport, ShotResult, Script } from '../src/lib/types';

// Explicit test-only local website. Speech still uses the REAL configured Kokoro service.
config.privateUrls = true;
config.dataDir = path.resolve('test-output/smoke');
const paragraphs = [
  'NoteHarbor converts Markdown documents into searchable notes, making it easier to find examples and reference material when you need them.',
  'The workspace brings your project documents into one library, where you can browse topics, inspect code samples, and follow links back to the original files.',
  'Its preview shows headings, lists, and formatted code blocks side by side with the source document, so readers can check how their notes will appear.',
  'The example gallery includes a meeting outline, a technical reference, and a project checklist that demonstrate different ways to organize a document.',
  'Search lets you find matching words across your library and jump to the relevant section, while the topic list keeps related pages together.',
  'The public documentation explains how to import existing Markdown files and organize a small collection before adding more material to your workspace.',
];
const html = `<!doctype html><html><head><title>NoteHarbor | Document workspace</title><meta name="description" content="Markdown document workspace"><style>body{margin:0;font:24px Arial;background:#f3f7fc;color:#1d3558}nav{background:#275eaa;color:white;padding:32px}main{padding:60px 70px}section{padding:75px 0;border-bottom:1px solid #cbd8eb;min-height:450px}h1{font-size:62px}h2{font-size:40px}p{line-height:1.8}.demo{display:grid;grid-template-columns:1fr 1fr;gap:20px}.box{padding:35px;background:white;border:1px solid #d4e0f1;border-radius:20px}</style></head><body><nav>NoteHarbor</nav><main><h1>A home for your Markdown.</h1>${paragraphs.map((text, i) => `<section><h2>${['Find your notes', 'Your workspace', 'Document preview', 'Example gallery', 'Search your library', 'Documentation'][i]}</h2><p>${text}</p><div class="demo"><div class="box">${['Project notes', 'Document library', '# Project overview', 'Technical reference', 'Search results', 'Import Markdown'][i]}</div><div class="box">Browse · Preview · Organize</div></div></section>`).join('')}</main></body></html>`;
const server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); });
// Reopen the same fixture address when resuming so saved scenes remain replayable.
const resumedJob = process.env.SMOKE_RESUME_ID ? await getJob(process.env.SMOKE_RESUME_ID) : null;
if (process.env.SMOKE_RESUME_ID && !resumedJob) throw new Error('Smoke resume job not found');
const fixturePort = resumedJob ? Number(new URL(resumedJob.url).port) : 0;
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(fixturePort, '127.0.0.1', resolve); });
const port = (server.address() as import('node:net').AddressInfo).port;
try {
  const job = resumedJob || await createJob(`http://127.0.0.1:${port}`);
  if (!job) throw new Error('Smoke resume job not found');
  if (job.status === 'FAILED') { job.status = 'RECEIVED'; job.error = undefined; await saveJob(job); }
  console.log(`Running real browser + Kokoro + FFmpeg pipeline: ${job.id}`);
  const log = setInterval(async () => { const j = await getJob(job.id); console.log(`${j?.status}: ${j?.detail}`); }, 10000);
  try {
    const audioSource=process.env.SMOKE_AUDIO_SOURCE;
    const ownText=audioSource?(await readArtifact<Script>(audioSource,'script.json')).text:undefined;
    await approvedTestPipeline(job.id,{regenerate:process.env.SMOKE_REGENERATE==='true',ownText,upload:audioSource?async id=>{
      const {POST}=await import('../src/app/api/jobs/[id]/narration/route');
      const script=await readArtifact<Script>(id,'script.json'),form=new FormData();
      form.set('audio',new File([await readFile(path.join(jobDir(audioSource),'narration.wav'))],'external-narration.wav'));
      form.set('scriptVersion',String(script.review!.version));
      const response=await POST(new Request('http://localhost:3000/api/jobs/narration',{method:'POST',body:form}),{params:Promise.resolve({id})});
      assert.equal(response.status,202,await response.text());
    }:undefined});
  } finally { clearInterval(log); }
  const done = await getJob(job.id); assert.equal(done?.status, 'READY_FOR_REVIEW', done?.error);
  const file = path.join(jobDir(job.id), 'final.mp4');
  const info = await probe(file); const qa = await readArtifact<QAReport>(job.id, 'qa.json');
  assert.ok(qa.passed, JSON.stringify(qa)); assert.equal(info.streams.find(s => s.codec_type === 'video')?.width, 1080);
  assert.equal(info.streams.find(s => s.codec_type === 'video')?.height, 1920); assert.ok(info.streams.some(s => s.codec_type === 'audio'));
  const clips = await readArtifact<ShotResult[]>(job.id, 'recordings.json');
  assert.ok(clips.every(c => !c.fallback), 'The fixture should produce clean recordings without screenshots');
  const saved = await Promise.all(clips.map(c => stat(path.join(jobDir(job.id), c.clip))));
  // Simulate restart after recording: upstream stages and each successful clip must survive.
  done!.status = 'RECEIVED'; done!.completed = done!.completed.filter(s => s !== 'EDITING' && s !== 'QA'); await saveJob(done!);
  await runPipeline(job.id);
  assert.equal((await getJob(job.id))?.status, 'READY_FOR_REVIEW');
  const after = await Promise.all(clips.map(c => stat(path.join(jobDir(job.id), c.clip))));
  assert.deepEqual(after.map(s => s.mtimeMs), saved.map(s => s.mtimeMs), 'Completed browser footage must not be rerecorded');
  console.log(`PASS: ${Number(info.format.duration).toFixed(1)}s, 1080×1920, real narration, ${clips.length} clips, QA ${qa.score}%, resumable edit. MP4: ${file}`);
} finally { server.close(); }
