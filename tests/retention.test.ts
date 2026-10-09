import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { direct, validatePlan } from '../src/pipeline/direct';
import { validateRetention } from '../src/pipeline/retention';
import { cameraFilter } from '../src/pipeline/camera';
import type { Inventory, Transcript, VisualAsset } from '../src/lib/types';

function fixture(duration=9, media=true, room=false) {
  const url='https://github.com/example/editor';
  const sections=['Editor','Layers','Status'].map((heading,i)=>({id:`s${i}`,sceneId:`scene${i}`,pageId:'p',sourceId:'src',heading,order:i,selector:`#s${i}`,scrollY:i*3000,endY:i*3000+(room?2500:80),text:i===1?'Layers and masks stay editable.':'Editor is an offline image editor.',assetIds:[]}));
  const asset=(id:string,sectionId:string,description:string):VisualAsset=>({id,sectionId,sceneId:`scene${sectionId.slice(1)}`,sourceId:'src',type:'image',url,pageUrl:url,localPath:`assets/${id}.png`,description,features:[description],width:1600,height:1000,quality:.9,confidence:.9,animated:false,canEnlarge:true});
  const inventory:Inventory={contentMode:'promotional',sourceUrl:url,notes:[],pages:[{id:'p',sourceId:'src',url,title:'Editor',order:0,sections}],scenes:sections.map(s=>({id:s.sceneId,sectionId:s.id,sourceId:'src',title:s.heading,description:s.text,url,actions:[],screenshot:`${s.sceneId}.png`})),assets:media?[asset('hero','s0','Editor product UI with layers, masks, brushes and text controls'),asset('layers','s1','Editor screenshot with editable layers and masks')]:[]};
  const transcript:Transcript={duration:3+duration+6,words:[],timingSource:'fixture',segments:[{id:'intro',sceneId:'scene0',sectionId:'s0',text:'This is Editor, an offline image editor.',claimIds:['c0'],start:0,end:3},{id:'feature',sceneId:'scene1',sectionId:'s1',text:'Layers and masks stay editable throughout the editing workflow.',claimIds:['c1'],start:3,end:3+duration},{id:'end',sceneId:'scene2',sectionId:'s2',text:"It is early alpha. The appeal is an offline image editor with layers and masks.",claimIds:['c2'],start:3+duration,end:9+duration}]};
  return {inventory,transcript};
}

test('A: long page without media scrolls within useful room or records a justified hold',()=>{
  for(const room of [true,false]) {
    const {inventory,transcript}=fixture(9,false,room),shots=direct(transcript,inventory),feature=shots.find(s=>s.segmentId==='feature')!;
    assert.ok(feature.walkthrough?.pageMotion || feature.retention?.staticHoldReason);
    assert.ok(validatePlan(shots,inventory,transcript).passed);
  }
});
test('B: feature evidence entering at the first word is not rejected for lacking a one-second prefix',()=>{
  const {inventory,transcript}=fixture(),shots=direct(transcript,inventory),media=shots.filter(s=>s.segmentId==='feature' && s.assetId==='layers');
  assert.ok(media.length,'Product screenshot must replace the long prose beat');
  assert.ok(media[0].start<=transcript.segments[1].start+.025);
  assert.ok(media.at(-1)!.start+media.at(-1)!.duration>=transcript.segments[1].end-.025);
  assert.ok(validatePlan(shots,inventory,transcript).passed,JSON.stringify(validatePlan(shots,inventory,transcript).issues));
});
test('C: long evidence keeps the same source, establishes wide and uses bounded attention motion',()=>{
  const {inventory,transcript}=fixture(),shots=direct(transcript,inventory),media=shots.filter(s=>s.segmentId==='feature' && s.assetId==='layers');
  assert.equal(media.length,1);
  assert.ok(media[0].mediaMotion);
  assert.ok(media[0].mediaMotion!.maxZoom<=1.05);
  assert.ok(media[0].mediaMotion!.holdIn>=1.5);
  assert.match(cameraFilter(media[0]),/perspective/);
  assert.equal(media[0].cameraMode,'media');
});
test('D: caveat context yields to the hero for the complete final takeaway, with intentional reuse',()=>{
  const {inventory,transcript}=fixture(),shots=direct(transcript,inventory),ending=shots.at(-1)!;
  assert.equal(ending.walkthrough?.role,'ending');
  assert.equal(ending.assetId,'hero');
  assert.ok(ending.duration>=3);
  assert.equal(ending.retention?.role,'hero');
  assert.ok(shots.some(s=>s.segmentId==='end' && s.cameraMode==='walkthrough'));
  assert.ok(validatePlan(shots,inventory,transcript).passed,JSON.stringify(validatePlan(shots,inventory,transcript).issues));
  assert.ok(!validateRetention(shots,inventory,transcript).issues.some(i=>i.code==='weak-ending'));
});
test('E: a short feature beat gains no unnecessary camera movement or forced cutaway',()=>{
  const {inventory,transcript}=fixture(2.5),shots=direct(transcript,inventory),feature=shots.filter(s=>s.segmentId==='feature');
  assert.equal(feature.length,1);
  assert.ok(!feature[0].mediaMotion && !feature[0].walkthrough?.pageMotion);
});
test('retention catches compact-page dwell, missing evidence, midpoint, dominance and generic ending as warnings',()=>{
  const {inventory,transcript}=fixture(),shots=direct(transcript,{...inventory,assets:[]});
  const report=validateRetention(shots,inventory,transcript);
  for(const code of ['generic-static-dwell','feature-without-evidence','midpoint-evidence','generic-page-dominance','weak-ending'])assert.ok(report.issues.some(i=>i.code===code),code);
  assert.ok(report.issues.filter(i=>i.code.startsWith('generic')||i.code==='weak-ending').every(i=>i.severity==='warning'));
});
test('F: captured PhotoCraft transcript gets PSD context, complete adjustment evidence and a hero ending',async()=>{
  const {inventory,transcript}:{inventory:Inventory;transcript:Transcript}=JSON.parse(await readFile(new URL('./fixtures/photocraft-retention.json',import.meta.url),'utf8'));
  const shots=direct(transcript,inventory),report=validatePlan(shots,inventory,transcript);
  assert.ok(report.passed,JSON.stringify(report.issues));
  assert.ok(shots.some(s=>s.segmentId==='segment-3' && s.type==='media_fullscreen'));
  const adjustments=shots.filter(s=>s.segmentId==='segment-4' && s.assetId==='asset-2');
  assert.ok(adjustments.reduce((n,s)=>n+s.duration,0)>6);
  assert.equal(shots.at(-1)!.assetId,'asset-1');
  assert.equal(shots.at(-1)!.walkthrough?.role,'ending');
  assert.ok(shots.at(-1)!.duration>=4);
  const metrics=validateRetention(shots,inventory,transcript).retention!;
  assert.ok(metrics.productMediaDuration>25 && metrics.heroDuration>5 && metrics.longestGenericDwell<4.8);
  assert.ok(!validateRetention(shots,inventory,transcript).issues.some(i=>['generic-static-dwell','weak-ending','midpoint-evidence','feature-without-evidence'].includes(i.code)),JSON.stringify(validateRetention(shots,inventory,transcript).issues));
});

test('dwell carries across duplicate shot IDs and counts a frozen tail after navigation, but ignores silence',()=>{
  const {inventory,transcript}=fixture(9,false),shots=direct(transcript,inventory),feature=shots.find(s=>s.segmentId==='feature')!;
  const halves=[{...feature,id:'a',duration:4.5},{...feature,id:'b',start:feature.start+4.5,duration:4.5,walkthrough:{...feature.walkthrough!,transition:undefined}}];
  const duplicate=[shots[0],...halves,...shots.filter(s=>s.segmentId==='end')];
  assert.ok(validateRetention(duplicate,inventory,transcript).issues.some(i=>i.code==='generic-static-dwell' && i.shotId==='b'));
  const silent={...transcript,segments:transcript.segments.map(b=>b.id==='feature'?{...b,end:b.start+2}:b)};
  assert.ok(!validateRetention(duplicate,inventory,silent).issues.some(i=>i.code==='generic-static-dwell' && ['a','b'].includes(i.shotId||'')));
});
test('retention does not fetch a distant feature image or another project just for movement',()=>{
  const {inventory,transcript}=fixture();
  inventory.assets=inventory.assets!.map(a=>a.id==='hero'?{...a,description:'Editor screenshot of the export dialog',features:['Export dialog']}: {...a,sourceId:'other-project'});
  const shots=direct(transcript,inventory);
  assert.ok(!shots.some(s=>s.segmentId==='feature' && s.cameraMode==='media'));
});
test('an explicit final installation instruction keeps its required documentation context',()=>{
  const {inventory,transcript}=fixture();
  transcript.segments[2].text='Install the editor using the documented installation steps.';
  assert.equal(direct(transcript,inventory).at(-1)!.cameraMode,'walkthrough');
});
test('intentional hero reuse earns no diversity penalty and subtle motion cannot exceed its source bounds',()=>{
  const {inventory,transcript}=fixture(),shots=direct(transcript,inventory),hero=shots.at(-1)!;
  const evidence=shots.find(s=>s.assetId==='layers')!;
  const reused={...hero,retention:{...hero.retention!,intentionalReuse:true},start:evidence.start+evidence.duration};
  assert.ok(!validatePlan([evidence,reused],inventory,transcript).issues.some(i=>i.code==='repeated-framing'));
  const bad=shots.map(s=>s===evidence?{...s,mediaMotion:{...s.mediaMotion!,maxZoom:1.2}}:s);
  assert.ok(validatePlan(bad,inventory,transcript).issues.some(i=>i.code==='media-attention'));
});
