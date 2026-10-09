import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import type {Job,Script} from '../src/lib/types';
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
let job:Job={id:'11111111-1111-1111-1111-111111111111',url:'https://github.com/storytold/photocraft',title:'PhotoCraft',status:'SCRIPT_REVIEW',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),revision:1,completed:['RESEARCHING','EXPLORING','SCRIPTING'],progress:.3,detail:'Review script',events:[]};
let script:Script={title:'PhotoCraft',mode:'extractive',text:'This is PhotoCraft, an open-source image editor.',segments:[{id:'seg1',sceneId:'scene1',text:'This is PhotoCraft, an open-source image editor.',claimIds:[]}],review:{version:1,source:'generated',state:'generated',createdAt:new Date().toISOString(),hash:'fixture'}};
script.quality={revision:1,status:'checked',selectedCandidate:'internal-winner',wordCount:9,revised:true,dimensions:{hook:4,clarity:5,progression:4,visualSupport:4,differentiation:4,speech:5,density:4,thesisFidelity:4},issues:[],notes:[],candidates:[],inspectedAssetIds:[]};
const actions:string[]=[];
const audio=await readFile('test-output/smoke/jobs/1a7bc546-6a6c-4757-90d9-7108cf0f55b1/narration.wav');
await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url());let body:unknown;
 if(url.pathname==='/api/settings')body={provider:'extractive',defaults:{model:'',effort:'default',creativity:'balanced'},environmentDefaults:{model:'',effort:'default',creativity:'balanced'},models:[]};
 else if(url.pathname==='/api/health')body={worker:true,tts:false,modelReady:true,model:'excerpts',renderer:'ffmpeg'};
 else if(url.pathname==='/api/jobs')body={jobs:[job]};
 else if(url.pathname.endsWith('/narration.wav'))return route.fulfill({contentType:'audio/wav',body:audio});
 else if(url.pathname.endsWith('/actions')) {
  const input=request.postDataJSON();actions.push(input.action);
  if(input.action==='regenerate-script'){assert.equal(input.feedback,'Less technical');script={...script,text:'This is PhotoCraft, an image editor with layers.',review:{...script.review!,version:2}};}
  if(input.action==='save-script'){script={...script,quality:undefined,text:input.text,segments:[{...script.segments[0],text:input.text}],review:{...script.review!,version:script.review!.version+1,source:input.source,state:input.source}};}
  if(input.action==='approve-script'){assert.equal(input.scriptVersion,script.review!.version);job.status='NARRATION_PENDING';script.review!.state='approved';}
  if(input.action==='generate-tts'){job.status='AUDIO_REVIEW';job.narration={version:1,source:'generated',state:'ready',scriptVersion:script.review!.version,scriptHash:'fixture',duration:11.5,createdAt:new Date().toISOString()};}
  if(input.action==='back-script'){job.status='SCRIPT_REVIEW';job.narration!.state='stale';script.review!.state=script.review!.source;}
  if(input.action==='replace-audio')job.status='NARRATION_PENDING';
  if(input.action==='approve-audio'){assert.equal(input.scriptVersion,script.review!.version);assert.equal(input.audioVersion,job.narration!.version);job.status='DIRECTING';}
  job={...job,revision:job.revision+1};body={job};
 }else if(url.pathname.endsWith('/narration')&&request.method()==='POST'){assert.match(request.headers()['content-type'],/multipart\/form-data/);job={...job,status:'AUDIO_REVIEW',narration:{version:2,source:'uploaded',state:'ready',scriptVersion:script.review!.version,scriptHash:'fixture',duration:11.5,createdAt:new Date().toISOString()}};body={job};}
 else body={job,script,research:null,inventory:null,transcript:null,qa:null};
 await route.fulfill({json:body});
});
try {
 await page.goto(process.env.STUDIO_TEST_URL||'http://127.0.0.1:3000');await page.getByLabel('VO script',{exact:true}).waitFor();
 await mkdir('test-output',{recursive:true});await page.getByText('VO writing check · 9 words · reviewed',{exact:true}).click();assert.equal(await page.locator('.vo-quality dt').count(),7);assert.ok(await page.getByText('Scores guide revision; your approval still controls the script.',{exact:false}).isVisible());assert.equal(await page.getByText('internal-winner',{exact:true}).count(),0);await page.screenshot({path:'test-output/script-review-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-output/script-review-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Writing check fits mobile width');await page.setViewportSize({width:1440,height:1100});
 await page.getByLabel('VO script',{exact:true}).fill('My exact custom script.');await page.waitForTimeout(2800);assert.equal(await page.getByLabel('VO script',{exact:true}).inputValue(),'My exact custom script.','Polling preserves unsaved edits');assert.equal(await page.getByRole('button',{name:'Approve script',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Save edits',exact:true}).click();await page.waitForTimeout(300);await page.reload();await page.getByLabel('VO script',{exact:true}).waitFor();assert.equal(await page.getByLabel('VO script',{exact:true}).inputValue(),'My exact custom script.');assert.equal(await page.locator('.vo-quality').count(),0,'Human edits remove obsolete generated scores');
 await page.getByText('Regenerate script',{exact:true}).first().click();await page.getByLabel('Optional direction').fill('Less technical');await page.getByRole('button',{name:'Regenerate script',exact:true}).click();await page.waitForTimeout(300);
 await page.getByRole('button',{name:'Use my own script',exact:true}).click();await page.getByLabel('VO script',{exact:true}).fill('An editor I want to show you.');await page.getByRole('button',{name:'Save my script',exact:true}).click();await page.waitForTimeout(300);
 await page.getByRole('button',{name:'Approve script',exact:true}).click();await page.getByRole('button',{name:'Generate TTS',exact:true}).waitFor();await page.getByRole('button',{name:'Generate TTS',exact:true}).click();await page.getByRole('button',{name:'Approve & generate video',exact:true}).waitFor();await page.screenshot({path:'test-output/audio-review-desktop.png'});
 await page.getByRole('button',{name:'Back to script',exact:true}).click();await page.getByLabel('VO script',{exact:true}).waitFor();assert.equal(job.narration!.state,'stale');await page.getByLabel('VO script',{exact:true}).fill('An editor with layers and masks.');await page.getByRole('button',{name:'Save my script',exact:true}).click();await page.waitForTimeout(300);await page.getByRole('button',{name:'Approve script',exact:true}).click();await page.getByLabel('Narration file').setInputFiles({name:'external.wav',mimeType:'audio/wav',buffer:audio});await page.getByRole('button',{name:'Upload & align narration',exact:true}).click();await page.getByRole('button',{name:'Approve & generate video',exact:true}).waitFor();
 await page.reload();await page.getByRole('button',{name:'Approve & generate video',exact:true}).waitFor();assert.ok(await page.getByText('Uploaded Audio',{exact:true}).isVisible());
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-output/audio-review-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Review fits mobile width');await page.getByRole('button',{name:'Approve & generate video',exact:true}).click();assert.equal(job.status,'DIRECTING');assert.deepEqual(errors,[]);console.log('PASS: editable/reload/polling script, own script, regeneration feedback, generated voice, back/edit stale voice, upload, reload audio, mobile, explicit final approval.',actions);
}finally{await browser.close();}
