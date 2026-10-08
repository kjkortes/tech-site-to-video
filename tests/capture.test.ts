import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../src/lib/config';
import { jobDir } from '../src/lib/store';
import { run, probe } from '../src/lib/process';
import { recordShots } from '../src/pipeline/record';
import { editVideo } from '../src/pipeline/edit';
import { renderCameraClip } from '../src/pipeline/camera';
import { shotTypes, Shot, Inventory, VisualAsset } from '../src/lib/types';

// Removing any executor branch must break this real-media integration test.
test('all director treatments render real clips, retain captions, and retry only failed captures', async () => {
  const original = { ...config }; config.privateUrls = true; config.renderer = 'ffmpeg';
  config.dataDir = await mkdtemp(path.join(tmpdir(), 'frameforge-capture-'));
  const server = http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<title>Demo fixture</title><main><h1>Product</h1><button type="button" onclick="document.body.style.background=\'steelblue\'">Play demo</button><div style="height:5000px;background:linear-gradient(#123,#67a)">Feature</div></main>');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const id = randomUUID(), dir = jobDir(id); await mkdir(dir,{recursive:true});
    const url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    await run('ffmpeg',['-y','-f','lavfi','-i','testsrc2=s=1600x1000:r=30','-frames:v','1','-threads','1',path.join(dir,'product.png')]);
    await run('ffmpeg',['-y','-f','lavfi','-i','testsrc2=s=972x1130:r=30:d=0.6','-c:v','libx264','-threads','2','-preset','ultrafast',path.join(dir,'video.mp4')]);
    const base: VisualAsset = { id:'image',sceneId:'scene-1',sourceId:'source-1',type:'image',url,pageUrl:url,localPath:'product.png',description:'Layers screenshot',features:['Layers'],width:1600,height:1000,quality:.9,confidence:.9,canEnlarge:true,animated:false };
    const inventory: Inventory = {notes:[],scenes:[{id:'scene-1',sourceId:'source-1',url,title:'Fixture',description:'Product layers',actions:[],screenshot:'product.png'}],assets:[base,{...base,id:'section',type:'section'}, {...base,id:'video',type:'video',localPath:'video.mp4',animated:true},{...base,id:'code',type:'code',text:'npm install example\nexample --export output.png'}, {...base,id:'demo',type:'demo',actions:[{type:'click',text:'Play demo',role:'button'}]}, {...base,id:'missing',localPath:'missing.png'}]};
    const shots: Shot[] = shotTypes.map((type,i)=>({id:String(i+1).padStart(3,'0'),sceneId:'scene-1',assetId:type==='video_playback'?'video':type==='code_focus'?'code':type==='click_demo'?'demo':['establish','scroll_to','feature_card'].includes(type)?'section':'image',segmentId:'segment-1',url,actions:type==='click_demo'?[{type:'click',text:'Play demo',role:'button'}]:[],type,framing:['establish','scroll_to','click_demo'].includes(type)?'context':'product',start:i*.6,duration:.6,motion:type==='pan_media'?'pan-right':'slow-push',focus:type==='zoom_region'?{x:.3,y:.1,width:.6,height:.8}:undefined,highlight:type==='highlight'?{x:.6,y:.1,width:.3,height:.6}:undefined,diagram:type==='diagram'?{nodes:[{id:'cli',label:'CLI'},{id:'app',label:'Application'}],edges:[{from:'cli',to:'app',evidence:'The CLI controls the Application.'}]}:undefined,purpose:'Show real fixture',caption:'Fixture',captionPosition:i%2?'top-center':'bottom-center'}));
    // Missing originals should fall back after two local attempts, preserving all other clips.
    shots.push({...shots[2],id:'099',start:shots.length*.6,assetId:'missing'});
    const progress: string[] = [];
    const recordings = await recordShots(id,shots,inventory,async text=>{progress.push(text);});
    assert.equal(recordings.length,shots.length);
    assert.ok(recordings.slice(0,-1).every(r=>!r.fallback),JSON.stringify(progress));
    assert.equal(recordings.at(-1)!.attempts,2); assert.ok(recordings.at(-1)!.fallback);
    assert.match(recordings.at(-1)!.fallbackReason || '',/missing|No such file/i);
    const times = await Promise.all(recordings.map(r=>stat(path.join(dir,r.clip))));
    await recordShots(id,shots,inventory,async ()=>{});
    const reused = await Promise.all(recordings.map(r=>stat(path.join(dir,r.clip))));
    assert.deepEqual(reused.map(s=>s.mtimeMs),times.map(s=>s.mtimeMs));
    // A plan mutation invalidates only that shot, even though ordinal IDs are unchanged.
    const changed = shots.map((s,i)=>i===2?{...s,motion:'slow-pull' as const}:s);
    await recordShots(id,changed,inventory,async ()=>{});
    const modified = await Promise.all(recordings.map(r=>stat(path.join(dir,r.clip))));
    assert.notEqual(modified[2].mtimeMs,times[2].mtimeMs);
    assert.ok(modified.every((s,i)=>i===2 || s.mtimeMs===times[i].mtimeMs));
    const duration = shots.length*.6;
    await run('ffmpeg',['-y','-f','lavfi','-i','sine=frequency=440:sample_rate=24000','-t',String(duration),path.join(dir,'narration.wav')]);
    await editVideo(id,'Fixture',shots,recordings,{duration,segments:[],timingSource:'fixture',words:[{text:'Layers',start:0,end:duration}]});
    const rendered = await Promise.all(shots.map(s=>stat(path.join(dir,'render',`${s.id}.mp4`))));
    await editVideo(id,'Fixture',shots,recordings,{duration,segments:[],timingSource:'fixture',words:[{text:'Layers',start:0,end:duration}]});
    const resumed = await Promise.all(shots.map(s=>stat(path.join(dir,'render',`${s.id}.mp4`))));
    assert.deepEqual(resumed.map(s=>s.mtimeMs),rendered.map(s=>s.mtimeMs),'Successful edited shots should survive an edit restart');
    const info = await probe(path.join(dir,'final.mp4'));
    assert.equal(info.streams.find(s=>s.codec_type==='audio')?.sample_rate,'48000');
    assert.ok(Math.abs(Number(info.format.duration)-duration)<.1);
    const html = await readFile(path.join(dir,'composition/index.html'),'utf8');
    assert.match(html,/caption-top-center/); assert.match(html,/top:440px/);
    assert.match(await readFile(path.join(dir,'captions.ass'),'utf8'),/\\an8\\pos\(540,288\)/);
  } finally { server.close(); await rm(config.dataDir,{recursive:true,force:true}); Object.assign(config,original); }
});

test('virtual camera changes the image pixels over time while hold remains stable', async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'frameforge-camera-'));
  try {
    const source=path.join(dir,'source.png');
    await run('ffmpeg',['-y','-f','lavfi','-i','testsrc2=s=1600x1200','-frames:v','1','-threads','1',source]);
    const shot:Shot={id:'001',sceneId:'fixture',start:0,duration:.6,url:'https://example.com',actions:[],caption:'',type:'zoom_region',framing:'detail',motion:'slow-push',focus:{x:.2,y:.1,width:.6,height:.8}};
    async function pixels(file:string,time:string) { return (await promisify(execFile)('ffmpeg',['-v','error','-ss',time,'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{encoding:'buffer',maxBuffer:4_000_000})).stdout; }
    const pushed=path.join(dir,'push.mp4'), held=path.join(dir,'hold.mp4');
    await renderCameraClip(source,pushed,shot); await renderCameraClip(source,held,{...shot,motion:'hold'});
    assert.notDeepEqual(await pixels(pushed,'0'),await pixels(pushed,'0.5'));
    // H.264 may have a few quantization differences; a static decoded hold should be nearly identical.
    const a=await pixels(held,'0'),b=await pixels(held,'0.5');
    assert.equal(a.length,b.length); let difference=0; for(let i=0;i<a.length;i++) difference+=Math.abs(a[i]-b[i]);
    assert.ok(difference/a.length<.5);
  } finally {await rm(dir,{recursive:true,force:true});}
});
