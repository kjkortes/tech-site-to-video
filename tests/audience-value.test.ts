import test from 'node:test';
import assert from 'node:assert/strict';
import {withModelSettings} from '../src/lib/llm';
import {buildOutline} from '../src/pipeline/story';
import {writeScript} from '../src/pipeline/script';
import {inspectScriptQuality,qualityDimensions,type QualityDimension} from '../src/pipeline/script-quality';
import {scriptBrief} from '../src/pipeline/script-brief';
import {audienceValue,audienceBeatScore,promotionalClaim,fallbackAudience} from '../src/pipeline/audience-value';
import type {Research,Inventory,Script} from '../src/lib/types';

// Literal excerpts from captured README research. Validation is deliberately
// colocated with useful proof: selecting a section must not authorize all facts.
function fixture(other=false) {
 const title=other?'LocalSend':'PhotoCraft';
 const groups=other?[
  ['LocalSend is a free, open-source app that allows you to securely share files and messages with nearby devices over your local network without needing an internet connection.'],
  ["LocalSend doesn't require an internet connection or third-party servers."],
  ['All data is sent securely over HTTPS, and the TLS/SSL certificate is generated on the fly on each device.'],
  ['LocalSend uses a secure communication protocol that allows devices to communicate with each other using a REST API.'],
  ['LocalSend currently requires an older Flutter version (specified in .fvmrc).'],
  ['If you are having trouble sending or receiving files, you may need to configure your firewall to allow LocalSend to communicate over your local network.'],
 ]:[
  ['Image editing; an open-source, clean-room reimplementation of Adobe Photoshop, rebuilt in pure Rust.','Layers, masks, adjustment layers, layer styles, type, vectors, brushes and real PSD files, in a native app written entirely in Rust.'],
  ['Adjustment layers keep every edit live. Stack Levels, Curves, Vibrance, Hue/Saturation and a dozen more, mask them to an area, reorder them, or turn them off, and your original pixels never change.'],
  ['Open, edit and save layered Photoshop documents.','Re-saving keeps the render of 307 of the 309 psd-tools test files.','A re-saved file is not byte-identical to its source: PhotoCraft rewrites image resources, layer records and the composite.'],
  ['Two compositors: a CPU compositor serves as the reference oracle, and a wgpu compositor puts the canvas on the GPU.'],
  ['Every menu item, tool and dialog runs a command from one registry of 500+ commands. The UI, the CLI, the JSON control channel and the MCP server all call the same commands, so anything you can click, a script or an AI agent can do too.'],
  ['Status: PhotoCraft is in early alpha, and it is not yet a Photoshop replacement for daily professional work.'],
 ];
 const claims=groups.flatMap((g,i)=>g.map((quote,j)=>({id:`c${i}-${j}`,sourceId:'src',text:quote,quote})));
 const sections=groups.map((g,i)=>({id:`s${i}`,pageId:'p',sourceId:'src',sceneId:`scene${i}`,heading:`Capability ${i}`,text:g.join(' '),order:i,selector:`#s${i}`,scrollY:i*500,endY:(i+1)*500,assetIds:[]}));
 const research:Research={title,description:'',mode:'extractive',sources:[{id:'src',url:`https://github.com/${other?'localsend/localsend':'storytold/photocraft'}`,title,text:groups.flat().join(' ')}],claims};
 const inventory:Inventory={contentMode:'promotional',notes:[],pages:[{id:'p',sourceId:'src',title,url:research.sources[0].url,order:0,sections}],scenes:sections.map(s=>({id:s.sceneId,sourceId:'src',sectionId:s.id,url:research.sources[0].url,title:s.heading,description:s.text,actions:[],screenshot:''})),assets:[]};
 return {research,inventory};
}
const extractive=<T>(work:()=>Promise<T>)=>withModelSettings({provider:'extractive',model:'',effort:'default',creativity:'balanced'},work);
test('PhotoCraft promotional facts preserve workflow and numeric PSD proof, excluding colocated micro-caveats and renderer validation',()=>extractive(async()=>{
 const {research,inventory}=fixture();const outline=await buildOutline(research,inventory);
 const ids=outline.visits.flatMap(v=>v.claimIds);
 for(const id of ['c0-0','c0-1','c1-0','c2-0','c2-1','c5-0'])assert.ok(ids.includes(id),id);
 assert.ok((outline as typeof outline & {preferredProofClaimIds?:string[]}).preferredProofClaimIds?.includes('c2-1'));
 assert.equal(ids.includes('c2-2'),false,'byte nuance must not leak through the PSD section');
 assert.equal(outline.visits.some(v=>v.sectionId==='s3'),false,'CPU reference has no viewer payoff');
 const script=await writeScript(research,inventory,outline);
 assert.match(script.segments.map(s=>s.text).join(' '),/307.*309/);
 assert.doesNotMatch(script.segments.map(s=>s.text).join(' '),/reference oracle|byte-identical/);
 assert.ok(research.claims.some(c=>c.id==='c2-2'),'research remains available');
}));
test('developer mode retains implementation evidence and does not receive promotional technical-density warnings',()=>extractive(async()=>{
 const {research,inventory}=fixture();inventory.contentMode='developer';
 const outline=await buildOutline(research,inventory);const script=await writeScript(research,inventory,outline);
 assert.ok(outline.visits.some(v=>v.claimIds.includes('c2-2')));
 assert.ok(outline.visits.some(v=>v.sectionId==='s3'));
 const issues=inspectScriptQuality(script,inventory,outline);
 assert.equal(issues.some(i=>['technical-density','technical-trivia','audience-value'].includes(i.code)),false);
}));
test('an optional differentiator cannot crowd out selected high-value numeric capability proof',()=>extractive(async()=>{
 const {research,inventory}=fixture();const outline=await buildOutline(research,inventory);
 const script:Script={title:'PhotoCraft',mode:'model',segments:[
  {id:'intro',sceneId:'scene0',claimIds:['c0-0'],text:'This is PhotoCraft — an open-source image editor rebuilt in pure Rust.'},
  {id:'workflow',sceneId:'scene1',claimIds:['c1-0'],text:'Adjustment layers preserve your original pixels.'},
  {id:'psd',sceneId:'scene2',claimIds:['c2-0'],text:'Open, edit and save layered Photoshop documents.'},
  {id:'optional',sceneId:'scene4',claimIds:['c4-0'],text:'An AI agent can use the same commands.'},
  {id:'caveat',sceneId:'scene5',claimIds:['c5-0'],text:"It's still early alpha, so it isn't a daily Photoshop replacement yet."},
 ]};
 assert.ok(inspectScriptQuality(script,inventory,outline).some(i=>i.code==='audience-proof'));
}));
test('deep LocalSend documentation yields local-sharing value, not REST or build requirements',()=>extractive(async()=>{
 const {research,inventory}=fixture(true);const outline=await buildOutline(research,inventory);
 assert.ok(outline.visits.some(v=>v.claimIds.includes('c1-0')));
 assert.equal(outline.visits.some(v=>['s3','s4'].includes(v.sectionId)),false);
 const brief=scriptBrief(research,inventory,outline);
 assert.equal(brief.mode,'promotional');
 assert.ok(brief.omittedEvidence?.some(c=>c.claimId==='c3-0'));
 inventory.contentMode='tutorial';const tutorial=await buildOutline(research,inventory);
 assert.ok(tutorial.visits.some(v=>v.sectionId==='s4'));
}));
test('critic flags low-value engineering prose even when every beat supports the thesis',()=>extractive(async()=>{
 const {research,inventory}=fixture();const outline=await buildOutline(research,inventory);
 const script:Script={title:'PhotoCraft',mode:'model',contentMode:'promotional',segments:[
  {id:'intro',sceneId:'scene0',sectionId:'s0',claimIds:['c0-0'],text:'This is PhotoCraft — an open-source clean-room Photoshop reimplementation in pure Rust.'},
  {id:'proof',sceneId:'scene2',sectionId:'s2',claimIds:['c2-1','c2-2'],text:"PSD tests preserve renders in 307 of 309 files. Those saves aren't byte-identical."},
  {id:'renderer',sceneId:'scene3',sectionId:'s3',claimIds:['c3-0'],text:'The GPU renderer is tested against a CPU reference.'},
  {id:'end',sceneId:'scene5',sectionId:'s5',claimIds:['c5-0'],text:"It's early alpha. I'd explore it for that ambition: rebuilding the layered editing workflow."},
 ]};
 const issues=inspectScriptQuality(script,inventory,outline);
 assert.ok(qualityDimensions.includes('audienceValue' as QualityDimension));
 assert.ok(issues.some(i=>i.code==='audience-value'));
 assert.ok(issues.some(i=>i.code==='technical-density'));
 assert.ok(issues.some(i=>i.code==='weak-takeaway'));
}));

test('a highest-thesis renderer claim and strongest-proof bonus still cannot buy promotional runtime',()=>extractive(async()=>{
 const {research,inventory}=fixture();await buildOutline(research,inventory);
 const rank=research.editorial!.claims.find(c=>c.claimId==='c3-0')!;
 rank.category='CORE_PROOF';rank.thesisContribution=5;
 research.editorial!.strongestProof.unshift({text:research.claims.find(c=>c.id==='c3-0')!.quote,claimIds:['c3-0']});
 const outline=await buildOutline(research,inventory);
 assert.equal(outline.visits.some(v=>v.claimIds.includes('c3-0')),false);
 assert.ok(audienceBeatScore(rank,true)<audienceBeatScore(research.editorial!.claims.find(c=>c.claimId==='c1-0')!));
}));
test('technical words are allowed for a defining product or an explicitly stated user consequence',()=>extractive(async()=>{
 const {research,inventory}=fixture();const outline=await buildOutline(research,inventory);
 const script:Script={title:'PhotoCraft',mode:'model',segments:[
  {id:'intro',sceneId:'scene0',claimIds:['c0-0'],text:'This is PhotoCraft — an image editor built in pure Rust.'},
  {id:'proof',sceneId:'scene1',claimIds:['c1-0'],text:'The renderer keeps previews fast and visually consistent.'},
 ]};
 // This tests density only; grounding remains the independent model critic's job.
 assert.equal(inspectScriptQuality(script,inventory,outline).some(i=>['audience-value','technical-density'].includes(i.code)),false);
 const technicalProduct={category:'CORE_PROOF',thesisContribution:5,audience:{...fallbackAudience('A protocol inspector displays individual requests.','CORE_PROOF'),audienceRelevance:5,understandability:4,visualSupport:5,novelty:4,userValue:5,technicalComplexity:2,runtimeCost:2,essentialForAudience:true}};
 assert.ok(promotionalClaim(technicalProduct));assert.ok(audienceValue(technicalProduct)>3);
}));
test('a readiness caveat colocated with the introduction survives while other caveats are omitted',()=>extractive(async()=>{
 const {research,inventory}=fixture();
 const intro=inventory.pages![0].sections[0],status=inventory.pages![0].sections[5];
 intro.text+=' '+status.text;inventory.pages![0].sections.splice(5,1);
 const extra='Limitation: edits cannot be saved automatically.';
 intro.text+=' '+extra;research.sources[0].text+=' '+extra;research.claims.push({id:'extra-caveat',sourceId:'src',text:extra,quote:extra});
 await buildOutline(research,inventory);
 research.editorial!.importantCaveat={text:status.text+' '+extra,claimIds:['c5-0','extra-caveat']};
 const outline=await buildOutline(research,inventory);
 assert.ok(outline.visits[0].claimIds.includes('c5-0'));
 assert.equal(outline.visits[0].claimIds.includes('extra-caveat'),false);
 assert.equal(outline.visits.flatMap(v=>v.claimIds).includes('c2-2'),false);
}));
test('a material caveat essential to understanding the capability may accompany the main readiness caveat',()=>extractive(async()=>{
 const {research,inventory}=fixture();const quote='Limitation: imported text cannot be edited.';
 inventory.pages![0].sections[2].text+=' '+quote;research.sources[0].text+=' '+quote;
 research.claims.push({id:'critical-caveat',sourceId:'src',text:quote,quote});
 await buildOutline(research,inventory);
 const rank=research.editorial!.claims.find(c=>c.claimId==='critical-caveat')!;
 rank.audience.essentialForAudience=true;rank.audience.caveatImpact='material';
 const outline=await buildOutline(research,inventory);
 assert.ok(outline.visits.flatMap(v=>v.claimIds).includes('critical-caveat'));
 assert.ok(outline.visits.flatMap(v=>v.claimIds).includes('c5-0'));
}));
