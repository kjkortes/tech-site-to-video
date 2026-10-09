import test from 'node:test';
import assert from 'node:assert/strict';
import { direct, validatePlan } from '../src/pipeline/direct';
import type { Inventory, Transcript, Shot } from '../src/lib/types';

const url='https://example.com';
function fixture(duration:number,height=3200) {
  const section={id:'intro',pageId:'page',sourceId:'source',heading:'Editor',order:0,selector:'#intro',scrollY:0,endY:height,text:'Edit images with layers and masks. Supporting editing features.',assetIds:[],sceneId:'scene'};
  const inventory:Inventory={sourceUrl:url,pages:[{id:'page',sourceId:'source',url,title:'Editor',order:0,sections:[section,{...section,id:'install',heading:'Installation',order:1,selector:'#install',scrollY:height-80,endY:height+2000,sceneId:'install'}]}],scenes:[{id:'scene',sourceId:'source',sectionId:'intro',url,title:'Editor',description:section.text,actions:[],screenshot:'intro.png'}],notes:[]};
  const transcript:Transcript={duration,timingSource:'approved-words',words:[{text:'Edit',start:0,end:duration}],segments:[{id:'beat',sceneId:'scene',sectionId:'intro',text:section.text,claimIds:[],start:0,end:duration}]};
  return {inventory,transcript};
}
test('a seven-second contextual beat stays continuous and moves within its section after establishment',()=>{
  const {inventory,transcript}=fixture(7);const shots=direct(transcript,inventory);
  assert.equal(shots.length,1,'Long explanations must not be split into identical holds');
  const m=shots[0].walkthrough?.pageMotion;
  assert.ok(m,'Long page beat has a deterministic motion plan');
  assert.ok(m.holdIn>=.5 && m.holdOut>=.4);
  assert.ok(m.endY>m.startY && m.endY<=m.maxY && m.maxY<3200-1920);
  assert.ok(Math.abs(m.holdIn+m.motionDuration+m.holdOut-7)<.01);
  assert.equal(shots[0].motion,'hold','Page motion does not zoom the camera');
  assert.equal(shots[0].captionPosition,'bottom-center');
  assert.ok(validatePlan(shots,inventory,transcript).passed);
});
test('short and fully visible sections stay static; medium beats move only when space supports it',()=>{
  for(const [duration,height,moves] of [[2,3200,false],[4,3200,true],[7,250,false]] as const) {
    const {inventory,transcript}=fixture(duration,height);const shots=direct(transcript,inventory);
    assert.equal(!!shots[0].walkthrough?.pageMotion,moves);
  }
});
test('static-dwell QA sees unchanged contextual footage across shot IDs',()=>{
  const {inventory,transcript}=fixture(7);const base=direct(transcript,inventory)[0];
  const shots:Shot[]=[0,1].map(i=>({...base,id:String(i),start:i*3.5,duration:3.5,walkthrough:{...base.walkthrough!,pageMotion:undefined}}));
  assert.ok(validatePlan(shots,inventory,transcript).issues.some(i=>i.code==='static-dwell'));
});

test('motion QA rejects fast or out-of-section plans and exempts readable screenshots',()=>{
  const {inventory,transcript}=fixture(7),base=direct(transcript,inventory)[0],m=base.walkthrough!.pageMotion!;
  const invalid={...base,walkthrough:{...base.walkthrough!,pageMotion:{...m,endY:4000,maxY:4000}}};
  const issues=validatePlan([invalid],inventory,transcript).issues;
  assert.ok(issues.some(i=>i.code==='scroll-corridor' && i.severity==='error'));
  assert.ok(issues.some(i=>i.code==='scroll-speed'));
  const media={...base,type:'media_fullscreen' as const,cameraMode:'media' as const,walkthrough:{...base.walkthrough!,role:'cutaway' as const,pageMotion:undefined}};
  assert.ok(!validatePlan([media],inventory,transcript).issues.some(i=>i.code==='static-dwell'));
});

test('the browser drifts smoothly between holds, keeps captions fixed, and clamps a changed boundary',async()=>{
  const {launchBrowser,positionAtSection,resolvePageMotion,animatePageMotion}=await import('../src/pipeline/browser');
  const browser=await launchBrowser();
  try {
    const page=await browser.newPage({viewport:{width:1080,height:1920}});
    await page.setContent('<style>body{margin:0}#captions{position:fixed;left:96px;top:1344px}</style><main id="intro"><h1>Editor</h1><div style="height:3300px">Layers and masks</div><h2 id="install">Installation</h2><div style="height:2400px"></div></main><div id="captions">Fixed caption</div>');
    const {inventory,transcript}=fixture(4);const shot=direct(transcript,inventory)[0];
    await positionAtSection(page,shot.walkthrough!.location);
    const live=await resolvePageMotion(page,shot,inventory);assert.ok(live);
    const top=await page.locator('#captions').evaluate(el=>el.getBoundingClientRect().top);
    const samples=await animatePageMotion(page,live);
    assert.ok(samples.filter(s=>s.time<.5).every(s=>Math.abs(s.y-live.startY)<2),'Establish hold is still');
    assert.ok(samples.some(s=>s.time>1 && s.y>live.startY+10 && s.y<live.endY-10),'Real intermediate positions exist');
    assert.ok(samples.every((s,i)=>!i || s.y>=samples[i-1].y && s.y-samples[i-1].y<=80*(s.time-samples[i-1].time)+2),'No jumps, reversal, or distracting speed');
    assert.ok(samples.filter(s=>s.time>live.holdIn+live.motionDuration+.1).every(s=>Math.abs(s.y-live.endY)<2),'Settle hold is still');
    assert.equal(await page.locator('#captions').evaluate(el=>el.getBoundingClientRect().top),top);
    const exit={...shot.walkthrough!.location,scrollY:live.endY,offsetY:live.endY-live.startY};
    await page.evaluate(()=>scrollTo(0,2000));await positionAtSection(page,exit);
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-live.endY)<2,'Re-entry restores the drift endpoint');
    await page.locator('main > div').first().evaluate(el=>(el as HTMLElement).style.height='120px');
    assert.equal(await resolvePageMotion(page,shot,inventory),undefined,'A shrunken live section holds instead of drifting into Installation');
  } finally {await browser.close();}
});

test('motion QA flags an almost always moving video and consecutive long page drifts',()=>{
  const {inventory,transcript}=fixture(7),base=direct(transcript,inventory)[0],m=base.walkthrough!.pageMotion!;
  const shots=[0,1,2].map(i=>({...base,id:String(i),start:i*7,walkthrough:{...base.walkthrough!,pageMotion:{...m,motionDuration:5.75,holdOut:.6}}}));
  const report=validatePlan(shots,inventory,{...transcript,duration:21});
  assert.ok(report.issues.some(i=>i.code==='motion-budget' && i.severity==='error'));
  assert.ok(report.issues.some(i=>i.code==='consecutive-page-motion'));
});

test('a real source screenshot cutaway remains still through its full narration phrase',()=>{
  const {inventory}=fixture(9);const feature=inventory.pages![0].sections[1];
  feature.heading='Features';feature.text='Layers and masks preserve original pixels.';
  inventory.scenes.push({id:'install',sourceId:'source',sectionId:'install',url,title:'Features',description:feature.text,actions:[],screenshot:'features.png'});
  inventory.assets=[{id:'layers',sceneId:'install',sectionId:'install',sourceId:'source',type:'image',url,pageUrl:url,localPath:'layers.png',description:'Layers and masks preserve original pixels.',features:['layers','masks'],width:1600,height:1000,quality:.9,confidence:.9,animated:false,canEnlarge:true}];
  const transcript:Transcript={duration:9,timingSource:'approved-words',words:[{text:'For',start:2,end:2.5},{text:'editing',start:2.5,end:3.5},{text:'layers',start:3.5,end:4},{text:'and',start:4,end:4.5},{text:'masks',start:4.5,end:5},{text:'preserve',start:5,end:6},{text:'original',start:6,end:7},{text:'pixels',start:7,end:9}],segments:[{id:'intro',sceneId:'scene',sectionId:'intro',text:'This is Editor, an image editor.',claimIds:['intro'],start:0,end:2},{id:'features',sceneId:'install',sectionId:'install',text:'For editing, layers and masks preserve original pixels.',claimIds:['layers'],start:2,end:9}]};
  const shots=direct(transcript,inventory),media=shots.find(s=>s.assetId==='layers');
  assert.ok(media,'Relevant source media is selected by the existing support planner');
  assert.equal(media.type,'media_fullscreen');
  assert.equal(media.walkthrough?.pageMotion,undefined);
  assert.equal(media.motion,'hold');
  assert.ok(media.duration>=5 && media.start<=3.5 && media.start+media.duration>=9,'The complete voiced explanation keeps its readable screenshot');
});

test('recorded live endpoints carry into the next shot when reflow reduces travel',async()=>{
  const http=await import('node:http'),fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
  const {config}=await import('../src/lib/config'),{recordShots}=await import('../src/pipeline/record');
  const original={...config};config.privateUrls=true;config.dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'page-motion-continuity-'));
  const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<style>body{margin:0}h1{margin:0;height:100px}</style><title>Editor</title><main id="intro"><h1>Editor</h1><div style="height:600px;background:linear-gradient(#abc,#def)">Layers and masks</div><h2 id="install">Installation</h2><div style="height:3000px;background:linear-gradient(#def,#987)"></div></main>');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const {inventory,transcript}=fixture(9);const local=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    inventory.sourceUrl=local;inventory.pages![0].url=local;inventory.scenes[0].url=local;
    transcript.segments=[{...transcript.segments[0],end:7},{...transcript.segments[0],id:'ending',start:7,end:9}];
    const shots=direct(transcript,inventory);assert.ok(shots[0].walkthrough!.pageMotion!.endY>210);
    const results=await recordShots('00000000-0000-4000-8000-000000000001',shots,inventory,async()=>{});
    const actualEnd=results[0].pageMotion!.plan.endY;
    assert.ok(actualEnd<shots[0].walkthrough!.pageMotion!.endY,'Reflow reduces the live path');
    assert.ok(results[1].endLocation,'Recorder exposes the actual document endpoint for continuity');
    assert.ok(Math.abs(results[1].endLocation!.scrollY-actualEnd)<2,'Next shot restores the actual endpoint instead of jumping to the stale planned endpoint');
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(config.dataDir,{recursive:true,force:true});Object.assign(config,original);}
});

test('static-dwell QA also catches a long frozen tail after a short drift',()=>{
  const {inventory,transcript}=fixture(20,6000),shots=direct(transcript,inventory);
  assert.ok(shots[0].walkthrough?.pageMotion);
  assert.ok(validatePlan(shots,inventory,transcript).issues.some(i=>i.code==='static-dwell'),'A moving first portion cannot hide a long static remainder with further relevant room');
});

test('dense material that already fits the usable frame is held for inspection',()=>{
  const {inventory,transcript}=fixture(7,800);
  inventory.pages![0].sections[0].text='Detailed layers and masks inspection text. '.repeat(65);
  const shots=direct(transcript,inventory);
  assert.equal(shots[0].walkthrough?.pageMotion,undefined);
  assert.ok(!validatePlan(shots,inventory,transcript).issues.some(i=>i.code==='static-dwell'),'Purposeful reading time is not a motion defect');
});
