// Render a short, real-source excerpt through the alternate HyperFrames backend.
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, copyFile } from 'node:fs/promises';
import { config } from '../src/lib/config';
import { jobDir, readArtifact } from '../src/lib/store';
import { Shot, ShotResult, Transcript } from '../src/lib/types';
import { editVideo } from '../src/pipeline/edit';
import { probe, run } from '../src/lib/process';

config.dataDir=path.resolve('test-output/director-smoke');
const sourceId=process.argv[2]; if(!sourceId) throw new Error('Pass a completed director-smoke job ID');
const sourceShots=await readArtifact<Shot[]>(sourceId,'shot-plan.json');
const sourceRecordings=await readArtifact<ShotResult[]>(sourceId,'recordings.json');
const id=randomUUID(),dir=jobDir(id); await mkdir(path.join(dir,'clips'),{recursive:true});
const selected=[sourceShots[0],sourceShots.find(s=>s.cameraMode==='media')!,sourceShots.find(s=>s.cameraMode==='detail')||sourceShots.find(s=>s.cameraMode==='walkthrough' && s.walkthrough?.transition)!];
const shots:Shot[]=[], recordings:ShotResult[]=[];
for(let i=0;i<selected.length;i++) {
  const original=selected[i],recording=sourceRecordings.find(r=>r.id===original.id)!;
  const shot={...original,id:String(i+1).padStart(3,'0'),start:i,duration:1};
  const clip=`clips/${shot.id}${path.extname(recording.clip)}`;
  await copyFile(path.join(jobDir(sourceId),recording.clip),path.join(dir,clip));
  shots.push(shot);recordings.push({...recording,id:shot.id,clip,duration:1});
}
await run('ffmpeg',['-y','-i',path.join(jobDir(sourceId),'narration.wav'),'-t','3',path.join(dir,'narration.wav')]);
config.renderer='hyperframes';
const transcript=await readArtifact<Transcript>(sourceId,'transcript.json');
await editVideo(id,'PhotoCraft renderer verification',shots,recordings,{duration:3,segments:[],words:transcript.words.filter(w=>w.start<3).map(w=>({...w,end:Math.min(3,w.end)})),timingSource:'real-source-excerpt'});
const info=await probe(path.join(dir,'final.mp4'));
assert.equal(info.streams.find(s=>s.codec_type==='video')?.width,1080);
assert.equal(info.streams.find(s=>s.codec_type==='audio')?.sample_rate,'48000');
assert.ok(Math.abs(Number(info.format.duration)-3)<.1);
console.log(`HyperFrames render passed: ${path.join(dir,'final.mp4')}`);
