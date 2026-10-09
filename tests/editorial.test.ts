import test from 'node:test';
import assert from 'node:assert/strict';
import {withModelSettings} from '../src/lib/llm';
import {buildOutline} from '../src/pipeline/story';
import {writeScript} from '../src/pipeline/script';
import {inspectScriptQuality} from '../src/pipeline/script-quality';
import type {Research,Inventory,Script} from '../src/lib/types';

// The opening and pillars are from the captured PhotoCraft README. Minor
// screenshot-rich sections are deliberately placed before the core evidence.
export function editorialFixture(other=false) {
 const title=other?'LocalSend':'PhotoCraft';
 const quotes=other?[
  'LocalSend is a free, open-source app that allows you to securely share files and messages with nearby devices over your local network without needing an internet connection.',
  'Choose a colour theme and customize the download directory.',
  'Files transfer directly between nearby devices over the local network.',
  'HTTPS encryption protects transfers, and no external servers are required.',
  'The command-line interface can automate file transfers.',
  'Devices must be on the same local network; some routers block communication.',
 ]:[
  'Image editing; an open-source, clean-room reimplementation of Adobe Photoshop, rebuilt in pure Rust. Layers, masks, adjustment layers, layer styles, type, vectors, brushes and real PSD files, in a native app written entirely in Rust.',
  'Export As with format, quality, transparency and scale, plus a preview and an instant file-size estimate.',
  'The menus, shortcuts, panels and tools are where your hands expect them, from ⌘J to ⇧⌘D. If you know Photoshop, you already know PhotoCraft.',
  'Open, edit and save layered Photoshop documents.',
  'Every menu item, tool and dialog runs a command from one registry of 500+ commands. The UI, the CLI, the JSON control channel and the MCP server all call the same commands, so anything you can click, a script or an AI agent can do too.',
  'Status: PhotoCraft is in early alpha, and it is not yet a Photoshop replacement for daily professional work.',
 ];
 const headings=other?['LocalSend','Customization','Local transfers','Secure by design','Automation','Limitations']:['PhotoCraft','Ship it anywhere','Familiar by design','Real PSD files','Built for agents','Status'];
 const sections=quotes.map((text,i)=>({id:`s${i}`,pageId:'p',sourceId:'src',sceneId:`scene${i}`,heading:headings[i],text,order:i,selector:`#s${i}`,scrollY:i*500,endY:(i+1)*500,assetIds:[]}));
 const research:Research={title,description:'',mode:'extractive',sources:[{id:'src',url:`https://github.com/example/${title}`,title,text:quotes.join(' ')}],claims:quotes.map((quote,i)=>({id:`c${i}`,sourceId:'src',text:quote,quote}))};
 const inventory:Inventory={contentMode:'promotional',notes:[],pages:[{id:'p',sourceId:'src',title,url:research.sources[0].url,order:0,sections}],scenes:sections.map(s=>({id:s.sceneId,url:research.sources[0].url,title:s.heading,description:s.text,sourceId:'src',sectionId:s.id,actions:[],screenshot:''})),assets:[1,4].map(i=>({id:`a${i}`,sceneId:`scene${i}`,sectionId:`s${i}`,sourceId:'src',type:'image',url:'https://example.test/media',pageUrl:research.sources[0].url,description:headings[i],features:[],width:1600,height:1000,quality:1,confidence:1,animated:false,canEnlarge:true}))};
 for(let i=0;i<3;i++) {
  const quote=other?`A custom theme preset ${i+1} changes the colour of the window.`:`Export preset ${i+1} changes output quality and scale.`;
  const section={...sections[1],id:`minor-${i}`,sceneId:`minor-scene-${i}`,heading:`Appearance/output ${i+1}`,text:quote,order:1+(i+1)/10};
  inventory.pages![0].sections.push(section);inventory.scenes.push({id:section.sceneId,url:research.sources[0].url,title:section.heading,description:quote,sourceId:'src',sectionId:section.id,actions:[],screenshot:''});
  inventory.assets!.push({...inventory.assets![0],id:`minor-asset-${i}`,sceneId:section.sceneId,sectionId:section.id,description:section.heading});
  research.claims.push({id:`minor-claim-${i}`,sourceId:'src',text:quote,quote});research.sources[0].text+=' '+quote;
 }
 inventory.pages![0].sections.sort((a,b)=>a.order-b.order);
 return {research,inventory};
}
const extractive=<T>(work:()=>Promise<T>)=>withModelSettings({provider:'extractive',model:'',effort:'default',creativity:'balanced'},work);
for(const other of [false,true])test(`${other?'LocalSend':'PhotoCraft'} core evidence outranks screenshot-rich minor details`,()=>extractive(async()=>{
 const {research,inventory}=editorialFixture(other);
 const outline=await buildOutline(research,inventory);
 assert.ok(outline.visits.some(v=>v.sectionId==='s2'));
 assert.ok(outline.visits.some(v=>v.sectionId==='s3'));
 assert.equal(outline.visits.some(v=>v.sectionId==='s1'||v.sectionId.startsWith('minor-')),false);
 assert.equal(outline.visits.some(v=>v.storyRole==='surprise'),false);
 const script=await writeScript(research,inventory,outline);
 assert.ok(script.segments.slice(1).some(s=>s.claimIds.includes('c3')));
 assert.ok(research.editorial?.coreThesis.text);
 inventory.assets!.forEach(a=>{a.quality=0;a.confidence=0;});
 const withoutMedia=await buildOutline(research,inventory);
 assert.deepEqual(withoutMedia.visits.map(v=>v.sectionId),outline.visits.map(v=>v.sectionId));
}));
test('missing opening pillars are recovered from researched text before selection',()=>extractive(async()=>{
 const {research,inventory}=editorialFixture();research.claims=research.claims.filter(c=>c.id!=='c2');
 await buildOutline(research,inventory);
 assert.ok(research.claims.some(c=>c.quote.includes('menus, shortcuts')));
 assert.ok(research.claims.every(c=>research.sources[0].text.includes(c.quote)));
}));
test('correct identity with a minor-feature/automation body fails thesis fidelity',()=>extractive(async()=>{
 const {research,inventory}=editorialFixture();const outline=await buildOutline(research,inventory);
 const script:Script={title:'PhotoCraft',mode:'extractive',segments:[0,1,4,5].map(i=>({id:`seg${i}`,visitId:`v${i}`,sceneId:`scene${i}`,sectionId:`s${i}`,claimIds:[`c${i}`],text:i===0?'This is PhotoCraft — an open-source clean-room Photoshop reimplementation in Rust.':research.claims.find(c=>c.id===`c${i}`)!.quote}))};
 assert.ok(inspectScriptQuality(script,inventory,outline).some(i=>i.code==='thesis-fidelity'));
}));
test('a secondary differentiator may be omitted without a surprise penalty',()=>extractive(async()=>{
 const {research,inventory}=editorialFixture();const outline=await buildOutline(research,inventory);
 const script=await writeScript(research,inventory,outline);script.segments=script.segments.filter(s=>s.sectionId!=='s4');
 assert.equal(inspectScriptQuality(script,inventory,outline).some(i=>['missing-differentiator','early-reveal'].includes(i.code)),false);
}));

// Mock only the external model transport; planner, grounding, caching and scores
// run normally. A model choosing flashy secondary evidence is the failure case.
test('editorial-importance check repairs a planner that omits stronger proof',async()=>{
 const {config}=await import('../src/lib/config');
 const {fallbackEditorial,recoverEditorialEvidence}=await import('../src/pipeline/editorial');
 const {research,inventory}=editorialFixture();recoverEditorialEvidence(research,inventory);
 research.editorial={...fallbackEditorial(research),mode:'model'};
 const previousFetch=globalThis.fetch,key=config.llmKey;config.llmKey='fixture';
 globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({sectionIds:['s0','s4','s5']})}}]});
 try {
  const outline=await withModelSettings({provider:'api',model:'fixture',effort:'default',creativity:'balanced'},()=>buildOutline(research,inventory));
  assert.ok(outline.visits.some(v=>v.sectionId==='s2'));
  assert.equal(outline.visits.some(v=>v.sectionId==='s4'),false);
  assert.ok(outline.notes.some(n=>n.includes('omitted core proof')));
 }finally{globalThis.fetch=previousFetch;config.llmKey=key;}
});
test('model editorial analysis is reused across regeneration feedback and visual changes',async()=>{
 const {config}=await import('../src/lib/config');
 const {ensureEditorial,fallbackEditorial,recoverEditorialEvidence}=await import('../src/pipeline/editorial');
 const {research,inventory}=editorialFixture();recoverEditorialEvidence(research,inventory);
 const response=fallbackEditorial(research);let calls=0;
 const previousFetch=globalThis.fetch,key=config.llmKey;config.llmKey='fixture';
 globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify(response)}}]});};
 try {
  await withModelSettings({provider:'api',model:'fixture',effort:'default',creativity:'balanced'},async()=>{
   const first=await ensureEditorial(research,inventory);inventory.assets!.forEach(a=>a.quality=0);
   const second=await ensureEditorial(research,inventory);
   assert.equal(second,first);assert.equal(calls,1);assert.equal(first.mode,'model');
   assert.equal(first.claims.find(c=>c.claimId==='c1')!.category,'MINOR_FEATURE');
   assert.equal(first.claims.find(c=>c.claimId==='c4')!.category,'DIFFERENTIATOR');
  });
 }finally{globalThis.fetch=previousFetch;config.llmKey=key;}
});
test('invalid editorial references fall back to source-backed analysis',async()=>{
 const {config}=await import('../src/lib/config');
 const {ensureEditorial,fallbackEditorial,recoverEditorialEvidence}=await import('../src/pipeline/editorial');
 const {research,inventory}=editorialFixture();recoverEditorialEvidence(research,inventory);
 const response=fallbackEditorial(research);response.coreThesis.claimIds=['invented'];
 const previousFetch=globalThis.fetch,key=config.llmKey;config.llmKey='fixture';
 globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify(response)}}]});
 try {
  const brief=await withModelSettings({provider:'api',model:'fixture',effort:'default',creativity:'balanced'},()=>ensureEditorial(research,inventory));
  assert.equal(brief.mode,'extractive');assert.ok(brief.notes.some(n=>n.includes('known evidence')));
  assert.ok(brief.coreThesis.claimIds.every(id=>research.claims.some(c=>c.id===id)));
 }finally{globalThis.fetch=previousFetch;config.llmKey=key;}
});
test('a caveat point referencing proof cannot replace the actual readiness caveat visit',()=>extractive(async()=>{
 const {fallbackEditorial,recoverEditorialEvidence}=await import('../src/pipeline/editorial');
 const {research,inventory}=editorialFixture();recoverEditorialEvidence(research,inventory);
 research.editorial=fallbackEditorial(research);
 research.editorial.importantCaveat={text:'The PSD evidence is bounded; the app is early alpha.',claimIds:['c3','c5']};
 const outline=await buildOutline(research,inventory);
 assert.equal(outline.visits.find(v=>v.storyRole==='caveat')?.sectionId,'s5');
 const script=await writeScript(research,inventory,outline);
 assert.ok(script.segments.some(s=>s.claimIds.includes('c5')));
}));
test('export is core when exporting is the project thesis',()=>extractive(async()=>{
 const {research,inventory}=editorialFixture();
 const identity='ExportKit is an export tool.';
 const proof='Export presets control quality and scale with a preview.';
 research.title='ExportKit';research.claims=[{id:'c0',sourceId:'src',text:identity,quote:identity},{id:'c1',sourceId:'src',text:proof,quote:proof}];research.sources[0].text=identity+' '+proof;
 inventory.pages![0].sections=inventory.pages![0].sections.filter(s=>['s0','s1'].includes(s.id));
 inventory.pages![0].sections[0].text=identity;inventory.pages![0].sections[1].text=proof;
 const outline=await buildOutline(research,inventory);
 assert.ok(outline.visits.some(v=>v.sectionId==='s1'&&v.storyRole==='core-experience'));
}));
test('redundant compatibility proof yields to an omitted core workflow pillar',async()=>{
 const {config}=await import('../src/lib/config');
 const {fallbackEditorial,recoverEditorialEvidence}=await import('../src/pipeline/editorial');
 const {research,inventory}=editorialFixture();
 const quote='Layered PSD files preserve their render in a compatibility test corpus.';
 research.sources[0].text+=' '+quote;research.claims.push({id:'c6',sourceId:'src',text:quote,quote});
 const extra={...inventory.pages![0].sections.find(s=>s.id==='s3')!,id:'s6',sceneId:'scene6',text:quote,heading:'More compatibility tests',order:4.5};
 inventory.pages![0].sections.push(extra);inventory.pages![0].sections.sort((a,b)=>a.order-b.order);
 inventory.scenes.push({...inventory.scenes.find(s=>s.id==='scene3')!,id:'scene6',sectionId:'s6'});
 recoverEditorialEvidence(research,inventory);research.editorial={...fallbackEditorial(research),mode:'model'};
 research.editorial.coreCapabilities=[{text:'Familiar workflow',claimIds:['c2']},{text:'PSD interoperability',claimIds:['c3','c6']}];
 const previousFetch=globalThis.fetch,key=config.llmKey;config.llmKey='fixture';
 globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({sectionIds:['s0','s3','s6','s5']})}}]});
 try {
  const outline=await withModelSettings({provider:'api',model:'fixture',effort:'default',creativity:'balanced'},()=>buildOutline(research,inventory));
  assert.ok(outline.visits.some(v=>v.sectionId==='s2'),JSON.stringify(outline));
  assert.equal(outline.visits.some(v=>v.sectionId==='s6'),false);
 }finally{globalThis.fetch=previousFetch;config.llmKey=key;}
});
test('core proof in a researched documentation page is eligible without media',()=>extractive(async()=>{
 const {research,inventory}=editorialFixture();
 research.claims=research.claims.filter(c=>!['c2','c3'].includes(c.id));
 inventory.pages![0].sections=inventory.pages![0].sections.filter(s=>!['s2','s3'].includes(s.id));
 const quote='Open, edit and save layered Photoshop documents.';
 research.sources.push({id:'docs',url:'https://example.test/docs',title:'Document editing',text:quote});research.claims.push({id:'doc-proof',sourceId:'docs',text:quote,quote});
 const section={...inventory.pages![0].sections[0],id:'doc-section',pageId:'doc-page',sourceId:'docs',sceneId:'doc-scene',heading:'Document editing',text:quote,order:0};
 inventory.pages!.push({id:'doc-page',sourceId:'docs',title:'Docs',url:'https://example.test/docs',order:1,sections:[section]});
 inventory.scenes.push({id:'doc-scene',sourceId:'docs',sectionId:'doc-section',title:'Docs',description:quote,url:'https://example.test/docs',actions:[],screenshot:''});
 const outline=await buildOutline(research,inventory);
 assert.ok(outline.visits.some(v=>v.claimIds.includes('doc-proof')));
}));
