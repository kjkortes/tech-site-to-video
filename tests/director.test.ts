import test from 'node:test';
import assert from 'node:assert/strict';
import { direct } from '../src/pipeline/direct';
import { Inventory, Transcript } from '../src/lib/types';
const inventory: Inventory = { notes: [], scenes: [{ id: 'scene-1', sourceId: 'source-1', url: 'https://github.com/example/editor', title: 'Product overview', description: 'Layers masks adjustment panel', actions: [], screenshot: 'exploration/scene-1.png' }], assets: [
  { id: 'layers', sceneId: 'scene-1', sourceId: 'source-1', type: 'image', url: 'https://example.com/layers.png', pageUrl: 'https://github.com/example/editor', localPath: 'assets/layers.png', description: 'Layers masks adjustment panel screenshot', features: ['layers', 'masks'], width: 1800, height: 1100, quality: .95, confidence: .9, canEnlarge: true, animated: false },
  { id: 'output', sceneId: 'scene-1', sourceId: 'source-1', type: 'image', url: 'https://example.com/output.png', pageUrl: 'https://github.com/example/editor', localPath: 'assets/output.png', description: 'Export output rendering screenshot', features: ['export'], width: 1600, height: 900, quality: .9, confidence: .9, canEnlarge: true, animated: false },
] };
const transcript: Transcript = { duration: 24, timingSource: 'fixture', words: [], segments: [
  { id: 'seg-1', text: 'Layers masks and adjustment controls', sceneId: 'scene-1', claimIds: [], start: .2, end: 12 },
  { id: 'seg-2', text: 'For export, Export output rendering', sceneId: 'scene-1', claimIds: [], start: 12, end: 24 },
] };
test('director opens on the source page and preserves intentional narration slots', () => {
  const shots = direct(transcript, inventory);
  assert.equal(shots[0].assetId, 'scene-1');
  assert.equal(shots[0].type, 'walkthrough');
  assert.ok(shots.filter(s=>s.cameraMode==='walkthrough').reduce((n,s)=>n+s.duration,0)>=12);
  assert.ok(shots.some(s => s.assetId === 'output' && s.segmentId === 'seg-2'));
  assert.ok(shots.every(s => s.purpose && s.segmentId));
  assert.equal(shots[0].start, 0);
  assert.equal(shots.at(-1)!.start + shots.at(-1)!.duration, 24);
  assert.ok(shots.every((s, i) => !i || Math.abs(s.start - shots[i-1].start - shots[i-1].duration) < 1e-6));
});

test('visible scrolling is explicit, bounded and never consecutive', async () => {
  const { repairPlan, validatePlan } = await import('../src/pipeline/direct');
  const base = direct(transcript, inventory);
  const repetitive = base.map(s => ({ ...s, walkthrough: undefined, support:undefined, mediaMotion:undefined, cameraMode:'walkthrough' as const, assetId: 'scene-1', type: 'scroll_to' as const, framing: 'context' as const }));
  const broken = validatePlan(repetitive, inventory, transcript);
  assert.equal(broken.passed, false);
  assert.ok(broken.issues.some(i => i.code === 'consecutive-scroll'));
  assert.ok(broken.issues.some(i => i.code === 'scroll-budget'));
  const repaired = repairPlan(repetitive, inventory, transcript);
  assert.ok(validatePlan(repaired, inventory, transcript).passed);
  assert.ok(repaired.every((s,i) => s.type !== 'scroll_to' || s.duration <= 3 && repaired[i-1]?.type !== 'scroll_to'));
});
test('diagnostics catch repeated framing and wrong-source visual support', async () => {
  const { validatePlan } = await import('../src/pipeline/direct');
  const shots = direct(transcript, inventory).map(s => ({ ...s, assetId: 'layers', type: 'media_fullscreen' as const, framing: 'product' as const, focus: undefined }));
  assert.ok(validatePlan(shots, inventory, transcript).issues.some(i => i.code === 'repeated-framing'));
  const wrong = { ...inventory, assets: inventory.assets!.map(a => ({ ...a, sourceId: 'wrong' })) };
  assert.equal(validatePlan(shots, wrong, transcript).passed, false);
});

test('captions remain in the fixed lower band across cuts without retiming narration', async () => {
  const { directedCaptions, toAss } = await import('../src/pipeline/captions');
  const shots = direct(transcript,inventory).map((s,i)=>({...s,captionPosition:i?'top-center' as const:'bottom-right' as const}));
  const speech = {...transcript,words:[{text:'Layers',start:0,end:8}]};
  const captions = directedCaptions(speech,shots);
  assert.equal(captions.length,1);assert.equal(captions[0].position,'bottom-center');
  assert.equal(captions[0].start,0);assert.equal(captions[0].end,8);
  assert.match(toAss(captions),/\\an2\\pos\(474,1512\)/);
  assert.doesNotMatch(toAss(captions),/\\an8/);
});
test('model director rejects fabricated visuals and falls back to an executable saved intent', async () => {
  const { visualDirector } = await import('../src/pipeline/direct'); const { config } = await import('../src/lib/config');
  const original = {...config}; const fetch = globalThis.fetch;
  try {
    config.llmProvider='api';config.llmKey='fixture';
    globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({choices:[{shotId:'001',assetId:'invented',type:'media_fullscreen',purpose:'Fake',rationale:'',motion:'slow-push',captionPosition:'bottom-center'}, {shotId:'003',assetId:'output',type:'media_fullscreen',purpose:'Export output',rationale:'Show output',motion:'hold',captionPosition:'bottom-center'}]})}}]});
    const plan=await visualDirector(transcript,inventory,{title:'Fixture',description:'',mode:'extractive',claims:[],sources:[]});
    assert.ok(plan.diagnostics.passed); assert.ok(plan.notes.some(n=>n.includes('unknown')));
    assert.equal(plan.shots[0].assetId,'scene-1');
    assert.equal(plan.shots[0].cameraMode,'walkthrough','Model cannot replace the source-page intro');
  } finally {Object.assign(config,original);globalThis.fetch=fetch;}
});
test('diagram relationships require cited quotes and narrated labels', async()=>{
  const {validDiagram}=await import('../src/pipeline/direct');
  const research={title:'Fixture',description:'',mode:'extractive' as const,sources:[],claims:[{id:'claim-1',sourceId:'source-1',text:'CLI controls Application',quote:'The CLI controls the Application through a shared registry.'}]};
  const diagram={nodes:[{id:'cli',label:'CLI'},{id:'app',label:'Application'}],edges:[{from:'cli',to:'app',evidence:research.claims[0].quote}]};
  assert.ok(validDiagram(diagram,'CLI controls the Application',research,['claim-1']));
  assert.equal(validDiagram(diagram,'CLI controls the Application',research,[]),false);
  assert.equal(validDiagram({...diagram,edges:[{...diagram.edges[0],evidence:'CLI controls an invented Application'}]},'CLI controls the Application',research,['claim-1']),false);
});

test('word timestamps assign the actual spoken words to each visual slot', () => {
  const speech={...transcript,words:[{text:'Layers',start:.2,end:1},{text:'Masks',start:4.1,end:4.5},{text:'Controls',start:8.1,end:8.5},{text:'Export',start:12.1,end:13}]};
  const shots=direct(speech,inventory);
  assert.equal(shots[0].narration,'Layers Masks Controls','The continuous first beat owns all words in its timed span');
  assert.equal(shots[1].narration,'Export','Words from the next beat cannot leak into the first');
});
