import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { run } from '../src/lib/process';
import { renderCameraClip } from '../src/pipeline/camera';
import { panelFor, frameMarkup } from '../src/pipeline/video-layout';
import { Shot } from '../src/lib/types';

const shot:Shot={id:'001',sceneId:'scene',url:'https://github.com/example/editor',actions:[],caption:'',start:0,duration:.3,type:'media_fullscreen',framing:'product',motion:'hold'};
test('all source modes occupy the full portrait viewport without a persistent header or shell',()=>{
 for(const mode of ['context','product','detail'] as const)assert.deepEqual(panelFor(mode),{x:0,y:0,width:1080,height:1920});
 assert.doesNotMatch(frameMarkup('Editor',shot.url,'test'),/Software, in a minute|browser-outline|class="chrome"/);
});
test('media cutaway contains the full source and never composites unrelated README origin pixels',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'isolation-'));
 try {
  const source=path.join(dir,'source.png'),origin=path.join(dir,'origin.png'),out=path.join(dir,'out.mp4');
  await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=lime:s=1600x900','-frames:v','1','-threads','1',source]);
  await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=red:s=1280x1680','-frames:v','1','-threads','1',origin]);
  await renderCameraClip(source,out,shot,false,0,undefined,origin);
  const {stdout}=await promisify(execFile)('ffmpeg',['-v','error','-i',out,'-frames:v','1','-vf','scale=54:96','-f','rawvideo','-pix_fmt','rgb24','-'],{encoding:'buffer'});
  let red=0,green=0;for(let i=0;i<stdout.length;i+=3){if(stdout[i]>150 && stdout[i+1]<70)red++;if(stdout[i]<50 && stdout[i+1]>150)green++;}
  assert.equal(red,0,'No origin strip or unrelated source');assert.ok(green>1400 && green<1900,'Landscape source is fit-width, with its full height preserved');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('promotional planning/execution blocks source and generated code while developer mode retains it',async()=>{
 const {direct,validatePlan}=await import('../src/pipeline/direct');
 const {recordShots}=await import('../src/pipeline/record');
 const inventory={notes:[],scenes:[{id:'scene',sourceId:'s',url:shot.url,title:'Automation',description:'Shared commands automate editing.',actions:[],screenshot:'page.png'}],assets:[{id:'code',sceneId:'scene',sourceId:'s',type:'code' as const,url:shot.url,pageUrl:shot.url,localPath:'code.png',description:'Shared commands automate editing',features:['commands'],text:'editor --mcp --json',width:1200,height:400,quality:.9,confidence:.9,canEnlarge:true,animated:false}]};
 const speech={duration:6,segments:[{id:'beat',sceneId:'scene',claimIds:['c'],text:'Shared commands automate editing.',start:0,end:6}],words:[],timingSource:'fixture'};
 const promo=direct(speech,inventory);assert.ok(promo.every(s=>s.type!=='code_focus' && s.assetId!=='code'));
 const code={...promo[0],assetId:'code',type:'code_focus' as const};
 assert.ok(validatePlan([code],inventory,speech).issues.some(i=>i.code==='promotional-code'));
 await assert.rejects(recordShots('00000000-0000-0000-0000-000000000000',[code],inventory,async()=>{}),/Promotional capture rejects code/);
 assert.ok(direct({...speech,duration:16,segments:[{...speech.segments[0],end:6},{...speech.segments[0],id:'technical',text:'For automation, Shared commands automate editing.',start:6,end:16}]},{...inventory,contentMode:'developer'}).some(s=>s.type==='code_focus'));
});
test('camera projection reframes a lower-right feature above fixed captions without losing full-bleed scale',async()=>{
 const {projectedFocus,focalIsSafe}=await import('../src/pipeline/framing');
 const precise={...shot,cameraMode:'detail' as const,motion:'slow-push' as const,camera:{motion:'slow-push' as const,duration:3,offset:0,maxZoom:1.08,reason:'Inspect the explicitly narrated controls.',detailText:'controls',focus:{x:.79,y:.72,width:.2,height:.26}}};
 const size={width:1800,height:1000},r=projectedFocus(precise,size)!;
 assert.ok(focalIsSafe(precise,size),JSON.stringify(r));assert.ok(r.y+r.height<1344 && r.x+r.width<886);
 const {cameraFilter}=await import('../src/pipeline/camera');
 assert.doesNotMatch(cameraFilter(precise,size),/crop=w=trunc/,'Keep the full source available to pan; do not pre-crop to a feature');
});
test('media extraction falls back to the exact DOM image without capturing its README neighbours',async()=>{
 const {launchBrowser}=await import('../src/pipeline/browser');
 const {collectVisuals}=await import('../src/pipeline/visual-inventory');
 const {config}=await import('../src/lib/config');const {jobDir}=await import('../src/lib/store');
 const {randomUUID}=await import('node:crypto');const {mkdir,readFile}=await import('node:fs/promises');
 const browser=await launchBrowser(),dir=await mkdtemp(path.join(tmpdir(),'exact-image-')),oldDir=config.dataDir;config.dataDir=dir;
 try {
  const id=randomUUID();await mkdir(jobDir(id),{recursive:true});
  const green=path.join(dir,'green.png');await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=lime:s=400x240','-frames:v','1','-threads','1',green]);
  const page=await browser.newPage();const body=await readFile(green);
  await page.route('https://media.invalid/**',route=>route.fulfill({contentType:'image/png',body}));
  await page.setContent('<main><p>Unrelated README content</p><img width="400" height="240" src="https://media.invalid/image.png"><div style="height:200px;background:red">Other screenshots</div></main>');
  await page.locator('img').evaluate(async el=>{await (el as HTMLImageElement).decode();});
  const notes:string[]=[];const assets=await collectVisuals(id,page,{id:'scene',url:shot.url,title:'Editor',description:'Editor',actions:[],screenshot:'page.png'},0,notes);
  assert.equal(assets.length,1);assert.equal(assets[0].captureMethod,'element');assert.equal(assets[0].isolated,true);
  assert.equal(assets[0].width,400);assert.equal(assets[0].height,240);
  const file=path.join(jobDir(id),assets[0].localPath!);
  const {stdout}=await promisify(execFile)('ffmpeg',['-v','error','-i',file,'-vf','scale=40:24','-f','rawvideo','-pix_fmt','rgb24','-'],{encoding:'buffer'});
  let bad=0;for(let i=0;i<stdout.length;i+=3)if(stdout[i]>50||stdout[i+1]<150)bad++;
  assert.equal(bad,0,'Element pixels contain only the intended image, not adjacent text/thumbnails');
 }finally{await browser.close();await rm(dir,{recursive:true,force:true});config.dataDir=oldDir;}
});

test('a concise final takeaway preserves the status page as walkthrough context',async()=>{
 const {direct}=await import('../src/pipeline/direct');
 const inventory={notes:[],scenes:[{id:'scene',sourceId:'s',url:shot.url,title:'Intro',description:'Image editor',actions:[],screenshot:'page.png'},{id:'status',sourceId:'s',url:shot.url,title:'Status',description:'An early alpha project.',actions:[],screenshot:'status.png'}],assets:[{id:'app',sceneId:'scene',sourceId:'s',type:'image' as const,url:shot.url,pageUrl:shot.url,localPath:'app.png',description:'Image editor',features:['editor'],width:1600,height:900,quality:.9,confidence:.9,canEnlarge:true,animated:false}]};
 const speech={duration:10,segments:[{id:'intro',sceneId:'scene',claimIds:['c1'],text:'This is Editor, an image editor.',start:0,end:6},{id:'last',sceneId:'status',claimIds:['c2'],text:'It is an early alpha project.',start:6,end:10}],words:[],timingSource:'fixture'};
 const shots=direct(speech,inventory);assert.equal(shots.at(-1)!.assetId,'status');assert.equal(shots.at(-1)!.cameraMode,'walkthrough');
});

test('browser capture hides code in promotional mode and retains it in developer mode',async()=>{
 const http=await import('node:http');const {randomUUID}=await import('node:crypto');const {mkdir}=await import('node:fs/promises');
 const {config}=await import('../src/lib/config');const {jobDir}=await import('../src/lib/store');const {recordShots}=await import('../src/pipeline/record');
 const old={...config};config.privateUrls=true;config.dataDir=await mkdtemp(path.join(tmpdir(),'code-policy-'));
 const server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<title>Fixture</title><style>body{margin:0;background:lime}pre{margin:0;height:700px;background:red}</style><pre>editor --json --mcp</pre>');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const url=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  for(const contentMode of ['promotional','developer'] as const) {
   const id=randomUUID();await mkdir(jobDir(id),{recursive:true});
   const inventory={contentMode,notes:[],scenes:[{id:'scene',url,title:'Fixture',description:'Editor',actions:[],screenshot:'page.png'}]};
   const result=(await recordShots(id,[{...shot,url,type:'establish',framing:'context',motion:'hold'}],inventory,async()=>{}))[0];
   const {stdout}=await promisify(execFile)('ffmpeg',['-v','error','-ss',String(result.trimStart+.1),'-i',path.join(jobDir(id),result.clip),'-frames:v','1','-vf','scale=54:96','-f','rawvideo','-pix_fmt','rgb24','-'],{encoding:'buffer'});
   let red=0;for(let i=0;i<stdout.length;i+=3)if(stdout[i]>150&&stdout[i+1]<70)red++;
   assert.equal(red>0,contentMode==='developer','Real browser recording obeys the content mode, not only the planner');
  }
 }finally{server.close();await rm(config.dataDir,{recursive:true,force:true});Object.assign(config,old);}
});

test('controls at the top-left source edge can also enter the fixed safe focal area',async()=>{
 const {focalIsSafe,projectedFocus}=await import('../src/pipeline/framing');
 const s={...shot,cameraMode:'detail' as const,motion:'slow-push' as const,camera:{motion:'slow-push' as const,duration:3,offset:0,maxZoom:1.08,reason:'Inspect the explicitly narrated controls.',detailText:'controls',focus:{x:0,y:0,width:.12,height:.18}}};
 const size={width:1600,height:1000};assert.ok(focalIsSafe(s,size),JSON.stringify(projectedFocus(s,size)));
});
