import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from '../src/pipeline/browser';
import { mapDocument } from '../src/pipeline/document-map';
import { discoverVisuals } from '../src/pipeline/visual-inventory';
import { buildOutline } from '../src/pipeline/story';
import { direct, validatePlan, visualDirector } from '../src/pipeline/direct';
import { validateContinuity } from '../src/pipeline/walkthrough';
import { Inventory, Research, Transcript, VisualAsset } from '../src/lib/types';
import { creativeInstruction, withModelSettings } from '../src/lib/llm';
import { writeScript, validateScript } from '../src/pipeline/script';
import { positionAtSection, scrollToSection, relevantLinks } from '../src/pipeline/browser';

const url = 'https://example.test/editor';
const section = (id: string, order: number, text: string) => ({ id, pageId: 'page-1', sourceId: 'source-1', heading: id, order, selector: `#${id}`, scrollY: order * 500, endY: (order+1)*500, text, assetIds: [], sceneId: `scene-${order+1}` });
const sections = [section('intro',0,'Editor is an offline image editor.'),section('features',1,'Layers and masks edit images.'),section('commands',2,'The CLI runs shared commands.'),section('status',3,'Editor is in early alpha.')];
const media = (id: string, sectionId: string, type: VisualAsset['type'], description: string): VisualAsset => ({id,sectionId,type,description,sceneId:sections.find(s=>s.id===sectionId)!.sceneId,sourceId:'source-1',url,pageUrl:url,localPath:`assets/${id}.png`,features:[description],width:1600,height:1000,quality:.9,confidence:.9,animated:type==='gif',canEnlarge:true,text:type==='code'?'editor cli --layers':undefined});
const inventory: Inventory = { notes:[],mapRevision:1,pages:[{id:'page-1',sourceId:'source-1',url,title:'Editor',order:0,sections}],scenes:sections.map(s=>({id:s.sceneId,url,title:s.heading,description:s.text,sourceId:s.sourceId,sectionId:s.id,actions:[{type:'scroll',text:s.heading,y:s.scrollY}],screenshot:`exploration/${s.sceneId}.png`})),assets:[media('product','intro','image','Offline image editor'),media('layers','features','image','Layers masks'),media('animation','features','gif','Layers masks edit'),media('cli','commands','code','CLI shared commands')] };
const research: Research = { title:'Editor',description:'',mode:'extractive',sources:[{id:'source-1',url,title:'Editor',text:sections.map(s=>s.text).join(' ')}],claims:sections.map((s,i)=>({id:`c${i}`,sourceId:'source-1',text:s.text,quote:s.text})) };
const transcript: Transcript = { duration:44,words:[],timingSource:'fixture',segments:sections.map((s,i)=>({id:`seg${i}`,text:i===0?'This is Editor, an offline image editor.':s.text,sceneId:s.sceneId,sectionId:s.id,visitId:`visit-${i+1}`,claimIds:[`c${i}`],start:i*11,end:(i+1)*11})) };

test('DOM map and each grid image retain their own nearest section and document order', async()=>{
  const browser=await launchBrowser();
  try {
    const page=await browser.newPage();
    await page.setContent('<article class="markdown-body"><h1>Editor</h1><p>Offline image editor.</p><h2>Features</h2><p>Layers and masks.</p><table><tr><td><img src="https://example.test/a.png" width="600" height="400"></td><td><img src="https://example.test/b.png" width="600" height="400"></td></tr></table><h2>Commands</h2><pre>editor cli --layers</pre></article>');
    const map=await mapDocument(page,'source-1','page-1',0); const assets=await discoverVisuals(page);
    assert.deepEqual(map.sections.map(s=>s.heading),['Editor','Features','Commands']);
    const images=assets.filter(a=>a.type==='image');assert.equal(images.length,2);
    assert.ok(images.every(a=>a.sectionId===map.sections[1].id));
    assert.ok(images[0].documentOrder!<images[1].documentOrder!);
    assert.equal(assets.find(a=>a.type==='code')?.sectionId,map.sections[2].id);
  } finally { await browser.close(); }
});
test('outline follows source sections even when research claims arrive in arbitrary order', async()=>{
  const outline=await buildOutline({...research,claims:[research.claims[2],research.claims[0],research.claims[3],research.claims[1]]},inventory);
  assert.deepEqual(outline.visits.map(v=>v.sectionId),sections.map(s=>s.id));
});
test('README gallery images before their headings belong to their own feature cells, not neighbouring features',async()=>{
  const browser=await launchBrowser();
  try {
    const page=await browser.newPage();
    await page.setContent('<main><h1>Generic repository navigation</h1><article class="markdown-body"><h1>Editor</h1><p>Offline editor.</p><h2>Features</h2><table><tr><td><img src="https://example.test/layers.png" alt="Layers" width="600" height="400"><h3>Layers</h3><p>Layers preserve original pixels.</p></td><td><img src="https://example.test/export.png" alt="Export" width="600" height="400"><h3>Export</h3><p>Export images in multiple formats.</p></td></tr></table></article></main>');
    const map=await mapDocument(page,'source-1','page-1',0),images=(await discoverVisuals(page)).filter(a=>a.type==='image');
    assert.deepEqual(map.sections.map(s=>s.heading),['Editor','Features','Layers','Export']);
    assert.equal(images[0].sectionId,map.sections[2].id);assert.equal(images[1].sectionId,map.sections[3].id);
    assert.match(map.sections[2].selector,/td:nth-of-type/);
    assert.match(map.sections[2].text,/Layers preserve original pixels/);
    assert.doesNotMatch(map.sections[2].text,/Export images/);
  } finally {await browser.close();}
});
test('research link discovery deduplicates documents and skips irrelevant GitHub commit pages',()=>{
  const repo='https://github.com/example/editor';
  const links=relevantLinks(repo,[{text:'README features',href:`${repo}/commit/abc`},{text:'Docs',href:`${repo}/tree/main/docs`},{text:'Docs',href:`${repo}/tree/main/docs`}]);
  assert.deepEqual(links.map(l=>l.href),[`${repo}/tree/main/docs`]);
});
test('walkthrough retains context, advances forward, and returns from local media cutaways',()=>{
  const shots=direct(transcript,inventory);const report=validateContinuity(shots,inventory,transcript);
  assert.ok(report.passed,JSON.stringify(report.issues));
  assert.ok(report.browserDuration/transcript.duration>=.6);
  assert.ok(shots[0].duration<=2 && shots[0].assetId==='product');
  assert.ok(shots.some(s=>s.assetId==='animation' && s.type==='video_playback'));
  assert.ok(shots.some(s=>s.walkthrough?.role==='return'));
  for(const shot of shots.filter(s=>s.walkthrough?.role==='cutaway')) assert.equal(inventory.assets!.find(a=>a.id===shot.assetId)?.sectionId,shot.walkthrough!.location.sectionId);
  assert.ok(shots.some(s=>s.walkthrough?.transition && s.walkthrough.transition.duration<=2));
  assert.ok(validatePlan(shots,inventory,transcript).passed);
});
test('continuity rejects reverse travel, foreign cutaways and unintroduced code',()=>{
  const shots=direct(transcript,inventory);const cut=shots.findIndex(s=>s.walkthrough?.role==='cutaway');
  const foreign=shots.map((s,i)=>i===cut?{...s,assetId:'cli',type:'code_focus' as const}:s);
  const report=validateContinuity(foreign,inventory,transcript);
  assert.ok(report.issues.some(i=>i.code==='foreign-cutaway'));
  const swapped=shots.map(s=>s.walkthrough?.location.sectionId==='commands'?{...s,walkthrough:{...s.walkthrough,location:{...s.walkthrough.location,sectionIndex:0}}}:s);
  assert.ok(validateContinuity(swapped,inventory,transcript).issues.some(i=>i.code==='backward-travel'));
});
test('paragraph navigation stays forward and purposeful browser holds do not earn repetition penalties',()=>{
  const scoped={...inventory,assets:[],pages:[{...inventory.pages![0],sections:[{...sections[1],anchors:[{selector:'#layers',scrollY:900,text:'Layers preserve original pixels'},{selector:'#masks',scrollY:1300,text:'Masks target selected areas'}]}]}],scenes:[inventory.scenes[1]]};
  const speech={...transcript,duration:14,segments:[{...transcript.segments[1],start:0,end:14}],words:[{text:'Layers',start:3.6,end:4},{text:'preserve',start:4,end:4.2},{text:'pixels',start:4.2,end:4.4},{text:'Masks',start:7.2,end:7.5},{text:'selected',start:7.5,end:7.7},{text:'areas',start:7.7,end:8}]};
  const shots=direct(speech,scoped);
  assert.ok(shots.some(s=>s.walkthrough?.location.selector==='#layers'));
  assert.ok(shots.some(s=>s.walkthrough?.location.selector==='#masks'));
  const report=validatePlan(shots,scoped,speech);assert.ok(report.passed,JSON.stringify(report.issues));
  assert.ok(!validatePlan(shots,scoped,speech).issues.some(i=>i.code==='repeated-framing'||i.code==='long-context'));
  const reversed=shots.map((s,i)=>i===shots.length-1?{...s,walkthrough:{...s.walkthrough!,location:{...s.walkthrough!.location,scrollY:500}}}:s);
  assert.ok(validateContinuity(reversed,scoped,speech).issues.some(i=>i.code==='backward-travel'));
});
test('model visual selection cannot insert distant media into a contextual cutaway',async()=>{
  const original=globalThis.fetch;
  try {
    const base=direct(transcript,inventory),cut=base.find(s=>s.walkthrough?.role==='cutaway' && s.walkthrough.location.sectionId==='features')!;
    globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({choices:[{shotId:cut.id,assetId:'cli',type:'code_focus',purpose:'Commands',rationale:'Visually different',motion:'hold',captionPosition:'bottom-center'}]})}}]});
    const {config}=await import('../src/lib/config');const oldKey=config.llmKey;config.llmKey='fixture';
    try {
      const result=await withModelSettings({provider:'api',model:'fixture',effort:'high',creativity:'bold'},()=>visualDirector(transcript,inventory,research));
      assert.ok(result.notes.some(n=>n.includes('continuity-breaking')));
      assert.equal(result.shots.find(s=>s.id===cut.id)!.assetId,cut.assetId);assert.ok(result.diagnostics.passed);
    } finally {config.llmKey=oldKey;}
  } finally {globalThis.fetch=original;}
});
test('navigation stays restrained while script wording uses the chosen creativity without lowering effort',()=>{
  withModelSettings({provider:'codex',model:'gpt-6-sol',effort:'high',creativity:'bold'},()=>{
    assert.match(creativeInstruction('script'),/inventive/);
    assert.match(creativeInstruction('navigation'),/document order/);
    assert.doesNotMatch(creativeInstruction('navigation'),/Use inventive|fresh visual sequencing/);
    assert.match(creativeInstruction('research'),/precision/);
  });
});
test('short narration visits cut directly instead of forcing an overlong scroll transition',()=>{
  const speech={...transcript,duration:4,segments:transcript.segments.map((s,i)=>({...s,start:i,end:i+1}))};
  const shots=direct(speech,inventory),report=validatePlan(shots,inventory,speech);
  assert.ok(report.passed,JSON.stringify(report.issues));
  assert.ok(shots.every(s=>!s.walkthrough?.transition));
  assert.equal(shots.at(-1)!.start+shots.at(-1)!.duration,speech.duration);
});
test('script identifies the product immediately and rejects reordered section narration',async()=>{
  const script=await withModelSettings({provider:'extractive',model:'',effort:'default',creativity:'balanced'},()=>writeScript(research,inventory));
  assert.match(script.segments[0].text,/^This is Editor, an offline image editor/);
  assert.deepEqual(script.segments.map(s=>s.sectionId),sections.map(s=>s.id));
  assert.throws(()=>validateScript({...script,segments:[script.segments[0],script.segments[2],script.segments[1]]},research,inventory),/document order/);
  assert.throws(()=>validateScript({...script,segments:[{...script.segments[0],text:'Today we are checking out Editor.'},...script.segments.slice(1)]},research,inventory),/Opening/);
});
test('clean navigation scrolls from a stored section to its actual destination and restores the same return position',async()=>{
  const browser=await launchBrowser();
  try {
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    await page.setContent('<main><h1 id="intro">Editor</h1><div style="height:1800px"></div><h2 id="features">Features</h2><div style="height:1800px"></div><h2 id="commands">Commands</h2><div style="height:1800px"></div></main>');
    const location={pageId:'page-1',sectionId:'features',sectionIndex:1,url,scrollY:10,selector:'#features',heading:'Features'};
    const target=await positionAtSection(page,location);assert.ok(target>1000);
    await positionAtSection(page,{...location,selector:'#intro',heading:'Editor',sectionId:'intro',sectionIndex:0});
    await scrollToSection(page,location,.35);
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-target)<2,'Visible navigation lands on the section, not an arbitrary 300px travel');
    await page.evaluate(()=>scrollTo(0,4000));await positionAtSection(page,location);
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-target)<2,'Return framing matches the earlier section');
  } finally {await browser.close();}
});
