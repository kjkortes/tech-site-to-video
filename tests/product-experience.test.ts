import test from 'node:test';
import assert from 'node:assert/strict';
import {withModelSettings} from '../src/lib/llm';
import {buildOutline} from '../src/pipeline/story';
import {writeScript,validateScript} from '../src/pipeline/script';
import {inspectScriptQuality,qualityDimensions} from '../src/pipeline/script-quality';
import {direct,validatePlan} from '../src/pipeline/direct';
import {validateContinuity} from '../src/pipeline/walkthrough';
import type {Research,Inventory,Script} from '../src/lib/types';

// Exact captured PhotoCraft prose; Blender excerpts from its official README
// and versioned 3.0 Cycles notes, not a claim about current benchmark results.
// https://github.com/blender/blender
// https://developer.blender.org/docs/release_notes/3.0/cycles/
function fixture(blender=false) {
 const title=blender?'Blender':'PhotoCraft';
 const groups=blender?[
  ['Blender is the free and open source 3D creation suite. It supports the entirety of the 3D pipeline—modeling, rigging, animation, simulation, rendering, compositing, motion tracking and video editing.'],
  ['GPU kernels and scheduling have been rewritten for better performance, with rendering between 2x and 8x faster in real-world scenes.'],
 ]:[
  ['Image editing; an open-source, clean-room reimplementation of Adobe Photoshop, rebuilt in pure Rust. Layers, masks, adjustment layers, layer styles, type, vectors, brushes and real PSD files, in a native app written entirely in Rust. Open source, offline, and yours.'],
  ['Open, edit and save layered Photoshop documents. Re-saving keeps the render of 307 of the 309 psd-tools test files.'],
  ['Adjustment layers keep every edit live. Stack Levels, Curves, Vibrance, Hue/Saturation and a dozen more, mask them to an area, reorder them, or turn them off, and your original pixels never change.'],
  ['PhotoCraft is in early alpha, and it is not yet a Photoshop replacement for daily professional work.'],
 ];
 const sections=groups.map((g,i)=>({id:`s${i}`,pageId:'p',sourceId:'src',sceneId:`scene${i}`,heading:`Product section ${i}`,text:g.join(' '),order:i,selector:`#s${i}`,scrollY:i*500,endY:(i+1)*500,assetIds:[]}));
 const research:Research={title,mode:'extractive',description:'',sources:[{id:'src',url:`https://github.com/${blender?'blender/blender':'storytold/photocraft'}`,title,text:groups.flat().join(' ')}],claims:groups.flatMap((g,i)=>g.map((quote,j)=>({id:`c${i}-${j}`,sourceId:'src',text:quote,quote})))};
 const inventory:Inventory={contentMode:'promotional',notes:[],pages:[{id:'p',sourceId:'src',title,url:research.sources[0].url,order:0,sections}],scenes:sections.map(s=>({id:s.sceneId,sourceId:'src',sectionId:s.id,url:research.sources[0].url,title:s.heading,description:s.text,actions:[],screenshot:''})),assets:[]};
 return {research,inventory};
}
const extractive=<T>(work:()=>Promise<T>)=>withModelSettings({provider:'extractive',model:'',effort:'default',creativity:'balanced'},work);
test('PhotoCraft separates a bundled broad experience from identity before numeric proof, with grounded local visits',()=>extractive(async()=>{
 const {research,inventory}=fixture(),outline=await buildOutline(research,inventory);
 assert.deepEqual(outline.visits.slice(0,3).map(v=>v.storyRole),['introduction','core-experience','proof']);
 assert.equal(outline.visits[1].sectionId,outline.visits[0].sectionId);
 assert.ok(outline.visits[1].claimIds.some(id=>research.claims.find(c=>c.id===id)?.quote.startsWith('Layers, masks')));
 assert.ok(outline.visits[2].claimIds.includes('c1-0'));
 assert.ok(outline.visits.some(v=>v.storyRole==='depth'));
 const script=await writeScript(research,inventory,outline);validateScript(script,research,inventory);
 inventory.scenes.forEach(scene=>{scene.screenshot=`exploration/${scene.id}.png`;});
 const transcript={duration:script.segments.length*9,words:[],timingSource:'fixture',segments:script.segments.map((s,i)=>({...s,start:i*9,end:(i+1)*9}))};
 const shots=direct(transcript,inventory);validatePlan(shots,inventory,transcript);
 assert.equal(validateContinuity(shots,inventory,transcript).issues.some(i=>i.severity==='error'),false,'The split overview must preserve camera/source continuity');
 const text=script.segments.map(s=>s.text).join(' ');
 assert.ok(text.indexOf('Layers, masks')<text.indexOf('307'));
 assert.ok(research.editorial!.claims.some(c=>c.category==='CORE_EXPERIENCE'));
 assert.equal(research.editorial!.claims.find(c=>c.claimId==='c1-0')!.category,'CORE_PROOF');
 assert.equal(research.editorial!.claims.find(c=>c.claimId==='c2-0')!.experienceScope,'focused','Several color settings still belong to one focused capability');
}));
test('Blender breadth survives a concrete rendering performance result and is established first',()=>extractive(async()=>{
 const {research,inventory}=fixture(true),outline=await buildOutline(research,inventory);
 assert.deepEqual(outline.visits.map(v=>v.storyRole),['introduction','core-experience','proof']);
 const script=await writeScript(research,inventory,outline),text=script.segments.map(s=>s.text).join(' ');
 assert.ok(text.indexOf('modeling')<text.indexOf('2x'));
 assert.ok(outline.visits.at(-1)!.claimIds.includes('c1-0'));
 assert.ok(outline.visits[1].claimIds.every(id=>research.claims.find(c=>c.id===id)!.sourceId==='src'));
}));
test('critic detects underselling, metric before context and a repeated narrow-proof ending despite high thesis fidelity',()=>extractive(async()=>{
 const {research,inventory}=fixture(),outline=await buildOutline(research,inventory);
 const script:Script={title:'PhotoCraft',mode:'model',segments:[
  {id:'identity',sceneId:'scene0',claimIds:['c0-0'],text:'This is PhotoCraft — an open-source Photoshop-style image editor rebuilt in pure Rust.'},
  {id:'metric',sceneId:'scene1',claimIds:['c1-0'],text:'It preserved the rendered image for 307 of 309 PSD test files.'},
  {id:'narrow',sceneId:'scene2',claimIds:['c2-0'],text:'Color adjustments leave original pixels untouched.'},
  {id:'end',sceneId:'scene3',claimIds:['c3-0'],takeawayClaimIds:['c0-0','c1-0'],text:"It's early alpha. The draw is an open-source rebuild that already handles layered Photoshop documents."},
 ]};
 const codes=inspectScriptQuality(script,inventory,outline).map(i=>i.code);
 assert.ok(qualityDimensions.includes('productBreadth'));
 for(const code of ['product-breadth','proof-before-experience','repetitive-takeaway'])assert.ok(codes.includes(code),code);
}));
test('grouped experience in the opening earns breadth without a mandatory feature-by-feature list',()=>extractive(async()=>{
 const {research,inventory}=fixture(),outline=await buildOutline(research,inventory);
 const script:Script={title:'PhotoCraft',mode:'model',segments:[
  {id:'identity',sceneId:'scene0',claimIds:['c0-0'],text:'This is PhotoCraft — an open-source Photoshop-style image editor rebuilt in pure Rust. You get layers, masks, type and brushes.'},
  {id:'metric',sceneId:'scene1',claimIds:['c1-0'],text:'Re-saving preserves the rendered image in 307 of 309 PSD test files.'},
  {id:'end',sceneId:'scene3',claimIds:['c3-0'],takeawayClaimIds:['c0-0'],text:"It's early alpha, so it isn't a daily professional replacement yet. An open rebuild of a full image editor is one to watch."},
 ]};
 assert.equal(inspectScriptQuality(script,inventory,outline).some(i=>['product-breadth','proof-before-experience','repetitive-takeaway'].includes(i.code)),false);
}));
test('developer ordering retains source sections without a mandatory broad-experience slot',()=>extractive(async()=>{
 const {research,inventory}=fixture();inventory.contentMode='developer';const outline=await buildOutline(research,inventory);
 assert.deepEqual(outline.visits.map(v=>v.sectionId),['s0','s1','s2','s3']);
 const script=await writeScript(research,inventory,outline);
 assert.equal(inspectScriptQuality(script,inventory,outline).some(i=>['product-breadth','proof-before-experience','repetitive-takeaway'].includes(i.code)),false);
}));

test('proof encountered before the available breadth is omitted rather than moving citations across source sections',()=>extractive(async()=>{
 const {research,inventory}=fixture();
 const overview=research.claims[0].quote.split(/(?<=[.!?])\s+/)[1];
 research.claims[0].quote=research.claims[0].text=research.claims[0].quote.split(/(?<=[.!?])\s+/)[0];
 inventory.pages![0].sections[0].text=research.claims[0].quote;
 const experience={...inventory.pages![0].sections[2],id:'broad',sceneId:'broad-scene',order:1.5,text:overview};
 inventory.pages![0].sections.splice(2,0,experience);inventory.scenes.push({...inventory.scenes[0],id:experience.sceneId,sectionId:experience.id});
 const outline=await buildOutline(research,inventory);
 assert.equal(outline.visits[1].sectionId,'broad');assert.equal(outline.visits.some(v=>v.sectionId==='s1'),false);
 assert.ok(outline.notes.some(n=>n.includes('preserve source order')));
}));
