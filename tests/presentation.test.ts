import test from 'node:test';
import assert from 'node:assert/strict';
import { direct, validatePlan } from '../src/pipeline/direct';
import { captionAnchor, directedCaptions, toAss } from '../src/pipeline/captions';
import { Inventory, Transcript } from '../src/lib/types';

const url='https://example.test/editor';
const inventory:Inventory={notes:[],scenes:[{id:'intro',sectionId:'intro',sourceId:'source',url,title:'Editor',description:'Image editor',actions:[],screenshot:'intro.png'},{id:'layers',sectionId:'layers',sourceId:'source',url,title:'Layers',description:'Levels Curves masks adjustment layers',actions:[{type:'scroll',y:500}],screenshot:'layers.png'}],assets:[{id:'app',sceneId:'intro',sectionId:'intro',sourceId:'source',type:'image',url,pageUrl:url,localPath:'app.png',description:'Image editor',features:['Image editor'],width:2000,height:1200,quality:.9,confidence:.9,animated:false,canEnlarge:true},{id:'controls',sceneId:'layers',sectionId:'layers',sourceId:'source',type:'image',url,pageUrl:url,localPath:'controls.png',description:'Levels Curves masks adjustment layers',features:['Levels','Curves','masks'],width:2000,height:1200,quality:.9,confidence:.9,animated:false,canEnlarge:true}]};
const transcript:Transcript={duration:20,timingSource:'words',segments:[{id:'opening',sceneId:'intro',sectionId:'intro',visitId:'v1',claimIds:['c1'],text:'This is Editor, an image editor.',start:0,end:6},{id:'feature',sceneId:'layers',sectionId:'layers',visitId:'v2',claimIds:['c2'],text:'For adjustments, Levels and Curves can use masks. Original pixels stay unchanged.',start:6,end:20}],words:[{text:'This',start:.2,end:.6},{text:'is',start:.6,end:.9},{text:'Editor,',start:.9,end:1.8},{text:'an',start:1.8,end:2.1},{text:'image',start:2.1,end:3},{text:'editor.',start:3,end:5.7},{text:'For',start:6.1,end:6.5},{text:'adjustments,',start:6.5,end:7.9},{text:'Levels',start:8,end:9},{text:'and',start:9,end:9.3},{text:'Curves',start:9.3,end:10.5},{text:'can',start:10.5,end:10.8},{text:'use',start:10.8,end:11.2},{text:'masks.',start:11.2,end:13.2},{text:'Original',start:14,end:14.8},{text:'pixels',start:14.8,end:15.4},{text:'stay',start:15.4,end:16},{text:'unchanged.',start:16,end:19.4}]};

test('legacy top/right caption requests are locked to one lower platform-safe anchor',()=>{
  const anchor=captionAnchor('top-center');
  assert.ok(anchor.y>=1920*.71 && anchor.y<=1920*.81,'Caption must sit in the lower safe band');
  assert.deepEqual(anchor,captionAnchor('bottom-right'));
  assert.ok(anchor.x<1080*.82);
  const captions=directedCaptions(transcript,direct(transcript,inventory).map(s=>({...s,captionPosition:'top-center'})));
  assert.ok(captions.every(c=>c.position==='bottom-center'));
  assert.doesNotMatch(toAss(captions),/\\an8|\\pos\(540,288\)/);
});
test('actual source page remains visible throughout the opening sentence',()=>{
  const shots=direct(transcript,inventory);
  let end=0;
  for(const shot of shots){if(shot.assetId!=='intro')break;end=shot.start+shot.duration;}
  assert.ok(end>=5.7,'Opening page must cover the last word of the first sentence');
});
test('feature image remains through the complete explanation with explicit transcript support',()=>{
  const shots=direct(transcript,inventory),media=shots.filter(s=>s.assetId==='controls');
  assert.ok(media.length);
  assert.ok(media[0].start<=8 && media.at(-1)!.start+media.at(-1)!.duration>=19.4,'Do not return to README while layers/masks are still being explained');
  assert.ok(media.every(s=>'support' in s),'Persist the supported words, claim and source section');
  assert.ok(validatePlan(shots,inventory,transcript).passed);
});
test('ending preserves the walkthrough context instead of forcing a product montage',()=>{
  const speech={...transcript,duration:26,segments:[...transcript.segments,{...transcript.segments[1],id:'status',text:'It is early alpha. Watch its progress.',start:20,end:26}],words:[...transcript.words,{text:'It is early alpha.',start:20.2,end:23},{text:'Watch its progress.',start:23.1,end:25.7}]};
  const shots=direct(speech,inventory);assert.equal(shots.at(-1)!.cameraMode,'walkthrough');
  assert.ok(shots.filter(s=>s.segmentId==='status').reduce((n,s)=>n+s.duration,0)>=3);
});

test('coverage rejects early removal, late entry, changed sources, invented phrases and missing relevance',async()=>{
  const {validateCoverage}=await import('../src/pipeline/coverage');
  const shots=direct(transcript,inventory),first=shots.find(s=>s.assetId==='controls')!;
  const early=shots.filter(s=>s.assetId!=='controls' || s.start<15).map(s=>s.assetId==='controls'?{...s,duration:Math.min(s.duration,15-s.start)}:s);
  assert.ok(validateCoverage(early,inventory,transcript).issues.some(i=>i.code==='visual-coverage'));
  const late=shots.map(s=>s.id===first.id?{...s,start:s.start+1,duration:s.duration-1}:s);
  assert.equal(validateCoverage(late,inventory,transcript).passed,false);
  const different=shots.map(s=>s.id===first.id?{...s,assetId:'app'}:s);
  assert.ok(validateCoverage(different,inventory,transcript).issues.some(i=>i.code==='support-identity'));
  const invented=shots.map(s=>s.support?.id===first.support!.id?{...s,support:{...s.support!,supportedText:'It edits unsupported magic files'}}:s);
  assert.ok(validateCoverage(invented,inventory,transcript).issues.some(i=>i.code==='support-phrase'));
  const unexplained=shots.map(s=>s.id===first.id?{...s,support:undefined}:s);
  assert.ok(validateCoverage(unexplained,inventory,transcript).issues.some(i=>i.code==='unexplained-cutaway'));
});
test('one contextual screenshot can sustain multiple camera shots without a coverage gap',()=>{
  const media=direct(transcript,inventory).filter(s=>s.assetId==='controls');
  assert.equal(media.length,1);assert.equal(media[0].cameraMode,'media');assert.equal(media[0].motion,'hold');
  assert.ok(media.every(s=>s.support?.id===media[0].support?.id));
  assert.ok(media.every((s,i)=>!i || Math.abs(s.start-media[i-1].start-media[i-1].duration)<.001));
});
test('captions use two readable lines and all shot modes avoid platform and subtitle exclusions',async()=>{
  const {validateCaptions}=await import('../src/pipeline/captions');
  const {safeVisual}=await import('../src/pipeline/safe-area');const {panelFor}=await import('../src/pipeline/video-layout');
  const speech={...transcript,words:[],segments:[{...transcript.segments[0],text:'MMMM WWWW Layers, masks and non-destructive adjustment controls on a very detailed screenshot.',start:0,end:20}]};
  const captions=directedCaptions(speech,[]);
  assert.ok(validateCaptions(captions));assert.ok(captions.every(c=>c.lines!.length<=2 && c.fontSize!>=42));
  for(const framing of ['context','product','detail'] as const)assert.ok(safeVisual(panelFor(framing)));
});
test('source code line selection includes the actual command and pans long source lines',async()=>{
  const {codeLines,sourceCodeFilter}=await import('../src/pipeline/source-code');
  const asset={...inventory.assets![1],type:'code' as const,text:'# Intro\neditor run test.png\n\n# Let an agent drive it over MCP\neditor mcp',code:{fontSize:28,lines:[{number:4,region:{x:.02,y:.2,width:.9,height:.1}},{number:5,region:{x:.02,y:.3,width:.9,height:.1}}]},width:2600,height:400};
  const range=codeLines(asset,'Agents can use MCP');assert.equal(range.start,5);assert.equal(range.end,5,'Keep the actual command, not a long descriptive comment');
  const filter=sourceCodeFilter({...direct(transcript,inventory)[0],type:'code_focus',codeRange:range},asset);
  assert.match(filter,/crop=/);assert.match(filter,/min\(1,\(t\+/);
});
test('a cutaway returns to the same section when the relevant phrase finishes before the visit',()=>{
  const feature={...transcript.segments[1],text:'For adjustments, Levels and Curves can use masks. There is one catch: it is early alpha.'};
  const words=[...transcript.words.filter(w=>w.start<14),{text:'There is one catch: it is early alpha.',start:15,end:19.4}];
  const shots=direct({...transcript,segments:[transcript.segments[0],feature],words},inventory,[{beatId:'feature',assetId:'controls',supportedText:'Levels and Curves can use masks.',claimIds:['c2'],relevanceReason:'Actual controls show Levels, Curves and masks; the caveat afterwards is page context.'}]);
  const returnShot=shots.find(s=>s.walkthrough?.role==='return')!;
  assert.ok(returnShot.start>=13.2);const cut=shots.find(s=>s.assetId==='controls')!;
  assert.deepEqual(returnShot.walkthrough!.location,cut.walkthrough!.returnTarget);
});
test('sub-frame browser returns are absorbed into the relevant media, never flashed between explanations',()=>{
  const shots=direct(transcript,inventory);
  assert.ok(shots.every(s=>s.framing!=='context'||s.duration>=.8),'A few residual milliseconds must not become a README flash');
});
test('building the final payoff recalculates source-context navigation instead of truncating a scroll',()=>{
  const scoped={...inventory,pages:[{id:'page',sourceId:'source',url,title:'Editor',order:0,sections:inventory.scenes.map((s,i)=>({id:s.sectionId!,pageId:'page',sourceId:'source',heading:s.title,order:i,selector:'#'+s.id,scrollY:i*500,endY:(i+1)*1000,text:s.description,assetIds:[],sceneId:s.id,anchors:i?[{selector:'#release',scrollY:800,text:'releases Windows Linux web'},{selector:'#status',scrollY:1100,text:'early alpha daily work'}]:[]}))}]};
  const speech={...transcript,duration:34,segments:[...transcript.segments,{...transcript.segments[1],id:'status',text:'Releases support Windows, Linux and web. It is early alpha for daily work.',start:20,end:34}],words:[...transcript.words,{text:'Releases support Windows, Linux and web.',start:20.2,end:27},{text:'It is early alpha for daily work.',start:27.3,end:33.7}]};
  const shots=direct(speech,scoped),report=validatePlan(shots,scoped,speech);
  assert.ok(report.passed,JSON.stringify(report.issues));
  assert.ok(shots.every(s=>!s.walkthrough?.transition || s.walkthrough.transition.duration<=s.duration));
});
test('factual audit receives missing source antecedents only when they stay within the cited section',async()=>{
  const {addEvidenceContext}=await import('../src/pipeline/evidence-context');
  const text='Adjustment layers keep edits live. Stack Levels and Curves, then mask them.';
  const research={title:'Editor',description:'',mode:'extractive' as const,sources:[{id:'source',url,title:'Editor',text}],claims:[{id:'c2',sourceId:'source',text:'Adjustment layers include Levels and Curves.',quote:'Stack Levels and Curves, then mask them.'}]};
  const scoped={...inventory,scenes:[{...inventory.scenes[1],description:text}]};
  assert.deepEqual(addEvidenceContext(research,scoped),['c2']);assert.ok(research.claims[0].quote.includes('Adjustment layers keep edits live.'));
  assert.deepEqual(addEvidenceContext(research,scoped),[],'Context must not grow on every resume');
  const foreign={...research,claims:[{...research.claims[0],quote:'Stack Levels and Curves, then mask them.'}]};
  const missingSection={...inventory,scenes:[{...inventory.scenes[1],description:'Stack Levels and Curves, then mask them.'}]};
  assert.deepEqual(addEvidenceContext(foreign,missingSection),[],'Never borrow an antecedent from a different section');
});
