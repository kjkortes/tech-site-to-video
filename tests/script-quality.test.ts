import test from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../src/lib/config';
import {withModelSettings} from '../src/lib/llm';
import {writeScript,validateScript} from '../src/pipeline/script';
import {inspectScriptQuality,productOpening} from '../src/pipeline/script-quality';
import {addOverviewEvidence,scriptBrief,capabilityOverview} from '../src/pipeline/script-brief';
import {fallbackEditorial,recoverEditorialEvidence} from '../src/pipeline/editorial';
import {storyRevision,buildOutline} from '../src/pipeline/story';
import type {Script,Inventory,Research,StoryOutline} from '../src/lib/types';
const quotes=['Editor is an open-source image editor built in Rust. Layers, masks, type, brushes and PSD files are supported.','Adjustment layers can be reordered or switched off without changing original pixels.','Filters on smart objects stay editable.','Every action is a command; the interface and AI agents use the same commands.','Editor is in early alpha, not yet suitable for daily professional work.'];
const sections=quotes.map((text,i)=>({id:`s${i}`,pageId:'p',sourceId:'src',sceneId:`scene${i}`,heading:['Editor','Adjustments','Filters','Automation','Status'][i],text,order:i,selector:`#s${i}`,scrollY:i*500,endY:(i+1)*500,assetIds:i<3?[`asset${i}`]:[]}));
const inventory:Inventory={contentMode:'promotional',notes:[],scenes:sections.map(s=>({id:s.sceneId,url:'https://github.com/example/editor',title:s.heading,description:s.text,sourceId:'src',sectionId:s.id,actions:[],screenshot:`${s.id}.png`})),pages:[{id:'p',sourceId:'src',title:'Editor',url:'https://github.com/example/editor',order:0,sections}],assets:sections.slice(0,3).map((s,i)=>({id:`asset${i}`,type:'image',sectionId:s.id,sceneId:s.sceneId,sourceId:'src',url:'https://example.com/image.png',pageUrl:'https://github.com/example/editor',description:['Image editor with layers and masks','Adjustment panel shows editable layers','Filter preview'][i],features:[s.heading],localPath:`asset${i}.png`,width:1600,height:1000,quality:.9,confidence:.9,animated:false,canEnlarge:true}))};
const research:Research={title:'Editor',mode:'model',description:'',sources:[{id:'src',url:'https://github.com/example/editor',title:'Editor',text:quotes.join(' ')}],claims:quotes.map((quote,i)=>({id:`c${i}`,sourceId:'src',text:quote,quote}))};
recoverEditorialEvidence(research,inventory);research.editorial={...fallbackEditorial(research),mode:'model'};
const outline:StoryOutline={revision:storyRevision,notes:[],visits:sections.map((s,i)=>({id:`v${i}`,sceneId:s.sceneId,sectionId:s.id,claimIds:[`c${i}`],purpose:s.heading,reason:s.heading,storyRole:i===0?'introduction':i===3?'surprise':i===4?'caveat':'proof'}))};
const weak={id:'weak',angle:'feature summary',segments:quotes.map((_,i)=>({visitId:`v${i}`,claimIds:[`c${i}`],text:['This is Editor, an open-source image editor.','Its adjustment layers preserve pixels.','For filters, edits stay editable.','Beyond editing, AI agents use the same commands.','That is early alpha.'][i]}))};
const strong={id:'strong',angle:'familiar versus unusual',segments:[{visitId:'v0',claimIds:['c0'],text:'This is Editor — an open-source image editor built in Rust. It covers layers, masks, brushes and PSD files.'},{visitId:'v1',claimIds:['c1'],text:'Better yet, adjustments stay editable. Reorder them or switch them off without changing the original pixels.'},{visitId:'v3',claimIds:['c3'],text:'Underneath that familiar interface, every action is a command. AI agents can use those same commands too.'},{visitId:'v4',claimIds:['c4'],text:"The catch? It’s early alpha, so daily professional work is still a stretch. For now, it’s one to watch."}]};
const dimensions={hook:5,clarity:5,progression:5,visualSupport:5,differentiation:5,speech:5,density:5,thesisFidelity:5};
function evaluation(id:string,{supported=true,revise=false}:{supported?:boolean;revise?:boolean}={}){return {candidateId:id,supported,groundingIssues:supported?[]:['Unsupported production readiness claim'],dimensions,needsRevision:revise,revisionNotes:revise?['Group repeated editable-feature explanations and improve spoken cadence.']:[]};}
async function withMock(work:(requests:any[])=>Promise<void>,responses:object[]){const previousFetch=globalThis.fetch,key=config.llmKey,requests:any[]=[];config.llmKey='fixture';globalThis.fetch=async(_url,init)=>{const request=JSON.parse(init!.body as string);requests.push(request);const result=responses.shift();assert.ok(result,'Unexpected extra LLM call');return Response.json({choices:[{message:{content:JSON.stringify(result)}}]});};try{await withModelSettings({provider:'api',model:'chosen-writer',effort:'high',creativity:'balanced'},()=>work(requests));}finally{globalThis.fetch=previousFetch;config.llmKey=key;}}

test('quality heuristics catch the old summary cadence without imposing six paragraphs or comma-only hooks',()=>{
 assert.ok(productOpening('This is Editor — an image editor.','Editor'));assert.ok(productOpening('This is Editor, an image editor.','Editor'));assert.equal(productOpening("Today we're looking at Editor.",'Editor'),false);
 const script:Script={title:'Editor',mode:'model',revision:storyRevision,segments:weak.segments.map((s,i)=>({...s,id:`seg${i}`,sceneId:`scene${i}`,sectionId:`s${i}`}))};assert.ok(inspectScriptQuality(script,inventory,outline).some(i=>i.code==='summary-cadence'));assert.doesNotThrow(()=>validateScript({...script,segments:[{...script.segments[0],text:'This is Editor — an image editor.'},...script.segments.slice(1)]},research,inventory));
 assert.ok(inspectScriptQuality({...script,segments:[{...script.segments[0],text:'This is Editor, an image editor. The source says it supports masks.'}]},inventory,outline).some(i=>i.code==='spoken-attribution'));
});
test('brief contains real visual descriptions, section map, previous script and editorial feedback; restores missing overview quotes exactly',()=>{
 const facts=structuredClone(research);facts.claims[0].quote=quotes[0].split('. ')[0]+'.';assert.equal(addOverviewEvidence(facts,inventory).length,1);assert.ok(facts.claims.some(c=>c.id.startsWith('script-overview') && c.quote.includes('Layers, masks')));assert.ok(facts.claims.every(c=>facts.sources[0].text.includes(c.quote)));assert.equal(addOverviewEvidence(facts,inventory).length,0);
 const brief=scriptBrief(facts,inventory,outline,'Less technical',{title:'Editor',mode:'extractive',text:'Previous script',segments:[]});assert.equal(brief.previousScript,'Previous script');assert.equal(brief.revisionFeedback,'Less technical');assert.match(brief.visits[1].visuals[0].description,/Adjustment panel/);assert.equal(brief.documentMap[0].sections.length,5);
 assert.equal(capabilityOverview('The Great Wave off Kanagawa, Katsushika Hokusai, c. 1831.'),false);assert.equal(capabilityOverview('Editor on example.com, a caption card with layers, curves and live type.'),false);assert.equal(capabilityOverview('Digital, generative, music, games — if you make things, come say hi.'),false);
});
test('two candidates are independently grounded/scored and the stronger subset keeps media, late differentiator and caveat',()=>withMock(async requests=>{
 const script=await writeScript(structuredClone(research),inventory,outline);assert.equal(script.quality!.selectedCandidate,'strong');assert.equal(script.quality!.revised,false);assert.equal(script.segments.length,4);assert.deepEqual(script.outline!.visits.map(v=>v.id),['v0','v1','v3','v4']);assert.equal(requests.length,2);assert.equal(requests[0].temperature,.45);assert.equal(requests[1].temperature,.1);assert.ok(requests.every(r=>r.model==='chosen-writer'));assert.match(requests[0].messages[0].content,/TWO distinct/);assert.equal(script.quality!.status,'checked');
},[{candidates:[weak,strong]},{evaluations:[evaluation('weak',{revise:true}),evaluation('strong')]}]));
test('concrete cadence defects trigger one revision even when numeric scores are high, using feedback and the prior script',()=>withMock(async requests=>{
 const script=await writeScript(structuredClone(research),inventory,outline,'Shorter, less technical',{previous:{...research,title:'Editor',mode:'extractive',segments:[],text:'Prior VO'} as Script});assert.equal(requests.length,4);assert.equal(script.quality!.revised,true);assert.equal(script.quality!.selectedCandidate,'revised');assert.equal(script.quality!.feedback,'Shorter, less technical');const evidence=JSON.parse(requests[2].messages[1].content);assert.equal(evidence.previousScript,'Prior VO');assert.equal(evidence.revisionFeedback,'Shorter, less technical');assert.ok(evidence.revisionNotes.some((s:string)=>s.includes('documentation')));assert.match(requests[2].messages[0].content,/Return ONE revised candidate/);assert.doesNotMatch(requests[2].messages[0].content,/Produce TWO/);
},[{candidates:[weak,{...weak,id:'weak2'}]},{evaluations:[evaluation('weak'),evaluation('weak2')]},{...strong,id:'revised'},{evaluations:[evaluation('revised')]}]));
test('a remaining concrete weakness gets a second bounded revision with distinct report identifiers',()=>withMock(async requests=>{
 const script=await writeScript(structuredClone(research),inventory,outline);assert.equal(requests.length,6);assert.equal(script.quality!.status,'checked');assert.equal(script.quality!.selectedCandidate,'revision-2-retry');assert.equal(new Set(script.quality!.candidates.map(c=>c.id)).size,4);
},[{candidates:[weak,{...weak,id:'weak2'}]},{evaluations:[evaluation('weak',{revise:true}),evaluation('weak2',{revise:true})]},{...strong,id:'retry'},{evaluations:[evaluation('retry',{revise:true})]},{...strong,id:'retry'},{evaluations:[evaluation('revision-2-retry')]}]));
test('unsupported hype is rejected rather than accepted on a perfect style score',()=>withMock(async()=>{
 await assert.rejects(()=>writeScript(structuredClone(research),inventory,outline),/grounding review failed/);
},[{candidates:[strong,{...strong,id:'strong2'}]},{evaluations:[evaluation('strong',{supported:false}),evaluation('strong2',{supported:false})]},{...strong,id:'revision'},{evaluations:[evaluation('revision',{supported:false})]},{...strong,id:'revision2'},{evaluations:[evaluation('revision2',{supported:false})]}]));
test('candidate cannot omit the caveat, move claims to a different section, or override the source intro',()=>withMock(async()=>{
 const script=await writeScript(structuredClone(research),inventory,outline);assert.equal(script.quality!.selectedCandidate,'strong');assert.ok(script.quality!.candidates.some(c=>c.id==='bad'&&!c.supported&&c.issues.some(i=>i.code==='structure')));
},[{candidates:[{...strong,id:'bad',segments:strong.segments.slice(0,-1)},strong]},{evaluations:[evaluation('strong')]}]));
test('outline can omit secondary differentiation while retaining the caveat',()=>withMock(async()=>{
 const result=await buildOutline(structuredClone(research),inventory,'Focus on automation');assert.equal(result.visits.some(v=>v.sectionId==='s3'),false);assert.equal(result.visits.at(-1)!.sectionId,'s4');
},[{sectionIds:['s0','s1']}]));
test('promotional selection skips optional CLI sections and does not demand visuals with no evidence-backed visit',()=>withMock(async()=>{
 const altered=structuredClone(inventory);altered.pages![0].sections[2].heading='Command Line Interface';
 const result=await buildOutline(structuredClone(research),altered);assert.equal(result.visits.some(v=>v.sectionId==='s2'),false);
 const textOnly=structuredClone(inventory);textOnly.assets!.forEach(a=>a.sectionId='uncited-screenshot-section');
 const script:Script={title:'Editor',mode:'model',segments:strong.segments.map((s,i)=>({...s,id:`seg${i}`,sceneId:sections[Number(s.visitId.slice(1))].sceneId,sectionId:`s${s.visitId.slice(1)}`}))};
 assert.equal(inspectScriptQuality(script,textOnly,outline).some(i=>i.code==='visual-evidence'),false);
 assert.ok(scriptBrief(research,inventory,outline).visualInventory.some(a=>a.description.includes('Adjustment')));
},[{sectionIds:['s0','s1','s2','s3','s4']}]));

test('low thesis fidelity triggers revision despite excellent style scores',()=>withMock(async()=>{
 const script=await writeScript(structuredClone(research),inventory,outline,'You missed the point. Focus on compatibility.');
 assert.equal(script.quality!.revised,true);assert.equal(script.quality!.dimensions!.thesisFidelity,5);
},[{candidates:[strong,{...strong,id:'other'}]},{evaluations:['strong','other'].map(id=>({...evaluation(id),dimensions:{...dimensions,thesisFidelity:2}}))},{...strong,id:'thesis-revision'},{evaluations:[evaluation('thesis-revision')]}]));
test('writer may omit an old surprise visit while preserving identity, core evidence and caveat',()=>withMock(async()=>{
 const script=await writeScript(structuredClone(research),inventory,outline);
 assert.equal(script.quality!.selectedCandidate,'core-only');assert.equal(script.segments.some(s=>s.visitId==='v3'),false);
},[{candidates:[{...strong,id:'core-only',segments:strong.segments.filter(s=>s.visitId!=='v3')},{...strong,id:'core-only2',segments:strong.segments.filter(s=>s.visitId!=='v3')}]},{evaluations:[evaluation('core-only'),evaluation('core-only2')]}]));
test('a stylish thesis-drifting draft cannot beat a thesis-faithful draft',()=>withMock(async()=>{
 const script=await writeScript(structuredClone(research),inventory,outline);
 assert.equal(script.quality!.selectedCandidate,'faithful');assert.equal(script.quality!.revised,false);
},[{candidates:[{...strong,id:'stylish'},{...strong,id:'faithful'}]},{evaluations:[{...evaluation('stylish'),dimensions:{...dimensions,thesisFidelity:3}},{...evaluation('faithful'),dimensions:{hook:3,clarity:3,progression:3,visualSupport:3,differentiation:3,speech:3,density:3,thesisFidelity:4}}]}]));
