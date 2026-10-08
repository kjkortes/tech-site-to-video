import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraGeometry } from '../src/pipeline/framing';
import { cameraFilter } from '../src/pipeline/camera';
import { direct, repairPlan, validatePlan } from '../src/pipeline/direct';
import { cameraSummary, sourceTypeFor, validateCameraPlan } from '../src/pipeline/camera-policy';
import type { Inventory, Shot, Transcript } from '../src/lib/types';
const url='https://github.com/example/editor';
const inventory:Inventory={notes:[],scenes:[{id:'intro',sourceId:'s',url,title:'Editor',description:'Layers and masks',actions:[],screenshot:'intro.png'},{id:'feature',sourceId:'s',url,title:'Layers',description:'Layers and masks',actions:[{type:'scroll',y:2000}],screenshot:'feature.png'}],assets:[{id:'media',sourceId:'s',sceneId:'feature',type:'image',url,pageUrl:url,localPath:'media.png',description:'Layers and masks',features:['layers','masks'],width:1800,height:1000,confidence:.9,quality:.9,animated:false,canEnlarge:true}]};
const speech:Transcript={duration:24,timingSource:'fixture',words:[],segments:[{id:'a',sceneId:'intro',text:'This is Editor, an image editor.',claimIds:[],start:0,end:6},{id:'b',sceneId:'feature',text:'For editing, layers and masks preserve original pixels while edits remain live.',claimIds:[],start:6,end:18},{id:'c',sceneId:'feature',text:'It is early alpha. Watch its progress.',claimIds:[],start:18,end:24}]};
const base:Shot={id:'001',sceneId:'intro',url,actions:[],caption:'',start:0,duration:4,type:'media_fullscreen',motion:'hold'};
test('native walkthrough and landscape media retain the entire source at scale one',()=>{
 for(const [mode,size] of [['walkthrough',{width:1080,height:1920}],['media',{width:1800,height:1000}]] as const) {
  const shot={...base,cameraMode:mode};const g=cameraGeometry(shot,size);
  assert.equal(g.zoom,1);assert.equal(g.visibleSourceArea,1);
  assert.doesNotMatch(cameraFilter(shot,size),/zoompan|fillborders|aspect_ratio=increase/);
 }
});
test('source type intro policy is deterministic and cannot be replaced by a higher scoring screenshot',()=>{
 for(const [type,url] of [['githubRepo','https://github.com/example/editor'],['website','https://example.test/'],['documentation','https://docs.example.test/']] as const) {
  const i={...inventory,sourceType:type,scenes:inventory.scenes.map(s=>({...s,url}))};const shots=direct(speech,i);
  assert.equal(sourceTypeFor(i),type);assert.equal(shots[0].assetId,'intro');assert.equal(shots[0].cameraMode,'walkthrough');
  assert.ok(validateCameraPlan(shots,i,speech).passed);
  assert.ok(validateCameraPlan([{...shots[0],assetId:'media',type:'media_fullscreen',cameraMode:'media'},...shots.slice(1)],i,speech).issues.some(x=>x.code==='source-intro'));
 }
});
test('focus and repeated assets do not invent zoom; an explicit detail establishes and returns wide',()=>{
 const plain=direct(speech,inventory),media=plain.find(s=>s.cameraMode==='media')!;
 assert.ok(media);assert.ok(plain.every(s=>s.cameraMode!=='detail'));
 const focus={x:.82,y:.72,width:.17,height:.2};
 const automatic=repairPlan(plain.map(s=>s.id===media.id?{...s,focus,motion:'slow-push',type:'zoom_region'}:s),inventory,speech);
 assert.ok(automatic.every(s=>s.cameraMode!=='detail' && s.motion==='hold'));
 const detailed=repairPlan(plain.map(s=>s.id===media.id?{...s,type:'zoom_region',cameraMode:'detail',focus,camera:{focus,motion:'slow-push',duration:s.duration,offset:0,maxZoom:1.1,reason:'Inspect the explicitly narrated layer and mask controls.',detailText:'layers and masks'}}:s),inventory,speech);
 const report=validatePlan(detailed,inventory,speech);assert.ok(report.passed,JSON.stringify(report.issues));
 const idx=detailed.findIndex(s=>s.cameraMode==='detail');assert.ok(idx>0);
 assert.equal(detailed[idx-1].cameraMode,'media');assert.equal(detailed[idx+1].cameraMode,'media');assert.ok(detailed[idx].duration<=3);
 const g=cameraGeometry(detailed[idx],inventory.assets![0]);assert.equal(g.zoom,1.1);assert.ok(g.visibleSourceArea>.5);
 assert.ok(cameraSummary(detailed,inventory).contextualRatio>.8);
});
test('QA rejects missing detail context, unjustified zoom, excessive runtime and zoom limits',()=>{
 const shots=direct(speech,inventory),media=shots.find(s=>s.cameraMode==='media')!;
 const detail={...media,cameraMode:'detail' as const,type:'zoom_region' as const,camera:{motion:'slow-push' as const,duration:media.duration,offset:0,maxZoom:3,focus:{x:.8,y:.7,width:.1,height:.1}}};
 const broken=shots.map(s=>s.id===media.id?detail:s),report=validateCameraPlan(broken,inventory,speech);
 for(const code of ['detail-reason','detail-establish','detail-temporary','zoom-limit','zoom-ratio'])assert.ok(report.issues.some(i=>i.code===code),code);
 assert.equal(cameraGeometry(detail,inventory.assets![0]).zoom,1,'Unjustified detail cannot zoom even before QA');
});
test('the submitted landing URL remains the intro even if narration starts in a later document',()=>{
 const landing='https://example.test/',docs='https://example.test/docs/';
 const i:Inventory={...inventory,sourceUrl:landing,sourceType:'website',scenes:[{...inventory.scenes[0],url:landing},{...inventory.scenes[1],url:docs}]};
 const t={...speech,duration:8,segments:[{...speech.segments[1],start:0,end:8}]};
 const shots=direct(t,i);assert.equal(shots[0].url,landing);assert.equal(shots[0].assetId,'intro');
 assert.ok(shots.some(s=>s.url===docs));assert.ok(validatePlan(shots,i,t).passed,JSON.stringify(validatePlan(shots,i,t).issues));
});
