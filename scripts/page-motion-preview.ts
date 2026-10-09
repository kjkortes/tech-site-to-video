// Reuse approved source audio/script; write a separate, reviewable visual preview.
import path from 'node:path';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { config } from '../src/lib/config';
import { jobDir, readArtifact, writeArtifact } from '../src/lib/store';
import { direct, validatePlan } from '../src/pipeline/direct';
import { mapDocument, mapRevision } from '../src/pipeline/document-map';
import { launchBrowser, newContext, navigate, dismissConsent } from '../src/pipeline/browser';
import { promotionalCaptureCSS } from '../src/pipeline/content-policy';
import { validateRetention } from '../src/pipeline/retention';
import { validatePageMotion } from '../src/pipeline/page-motion';
import { recordShots } from '../src/pipeline/record';
import { editVideo } from '../src/pipeline/edit';
import { checkVideo } from '../src/pipeline/qa';
import { withModelSettings } from '../src/lib/llm';
import type { Inventory, Transcript, Research, Script, Shot } from '../src/lib/types';

const sourceId=process.argv[2];if(!sourceId)throw new Error('Pass a source job ID with approved narration');
const sourceDir=jobDir(sourceId);
config.dataDir=path.resolve(process.env.PREVIEW_DATA_DIR||'test-output/page-motion');config.database='';
const id=randomUUID(),dir=jobDir(id);await mkdir(dir,{recursive:true});
for(const name of ['assets','exploration','narration.wav','inventory.json','transcript.json','script.json','research.json'])await cp(path.join(sourceDir,name),path.join(dir,name),{recursive:true});
console.log(`Page motion preview: ${dir}`);
const inventory=await readArtifact<Inventory>(id,'inventory.json'),transcript=await readArtifact<Transcript>(id,'transcript.json'),research=await readArtifact<Research>(id,'research.json'),script=await readArtifact<Script>(id,'script.json');
const before=JSON.parse(await readFile(path.join(sourceDir,'shot-plan.json'),'utf8')) as Shot[];
const browser=await launchBrowser();
try {
  const context=await newContext(browser,undefined,inventory.contentMode),page=await context.newPage();
  for(const mapped of inventory.pages||[]) {
    if(!transcript.segments.some(b=>mapped.sections.some(s=>s.id===b.sectionId)))continue;
    await navigate(page,mapped.url);await dismissConsent(page);
    if(inventory.contentMode!=='developer' && inventory.contentMode!=='tutorial')await page.addStyleTag({content:promotionalCaptureCSS});
    const live=await mapDocument(page,mapped.sourceId,mapped.id,mapped.order);
    mapped.sections=mapped.sections.map(old=>{
      const section=live.sections.find(s=>s.heading===old.heading && s.selector===old.selector)||live.sections.find(s=>s.heading===old.heading);
      if(!section) {
        if(transcript.segments.some(b=>b.sectionId===old.id))throw new Error(`Narrated source section disappeared: ${old.heading}`);
        inventory.notes.push(`Preview preserved unused section metadata after source drift: ${old.heading}`);return old;
      }
      return {...old,scrollY:section.scrollY,endY:section.endY,selector:section.selector,anchors:section.anchors};
    });
  }
} finally {await browser.close();}
inventory.mapRevision=mapRevision;await writeArtifact(id,'inventory.json',inventory);
const shots=direct(transcript,inventory),diagnostics=validatePlan(shots,inventory,transcript),motion=validatePageMotion(shots,inventory,transcript);
await writeArtifact(id,'inventory.json',inventory);await writeArtifact(id,'retention-report.json',validateRetention(shots,inventory,transcript,script));await writeArtifact(id,'shot-plan.json',shots);await writeArtifact(id,'page-motion-report.json',{before:before.map(s=>({id:s.id,start:s.start,duration:s.duration,heading:s.walkthrough?.location.heading,assetId:s.assetId,type:s.type,role:s.retention?.role,mediaMotion:s.mediaMotion,support:s.support,motion:s.walkthrough?.pageMotion})),after:shots.map(s=>({id:s.id,start:s.start,duration:s.duration,heading:s.walkthrough?.location.heading,assetId:s.assetId,type:s.type,role:s.retention?.role,mediaMotion:s.mediaMotion,support:s.support,motion:s.walkthrough?.pageMotion})),diagnostics,motion});
console.log(JSON.stringify({shots:shots.map(s=>({id:s.id,start:s.start,duration:s.duration,heading:s.walkthrough?.location.heading,assetId:s.assetId,type:s.type,role:s.retention?.role,mediaMotion:s.mediaMotion,support:s.support,motion:s.walkthrough?.pageMotion})),diagnostics,motion},null,2));
if(!diagnostics.passed)throw new Error('Preview plan rejected');
const recordings=await recordShots(id,shots,inventory,async detail=>console.log(detail));
await editVideo(id,research.title,shots,recordings,transcript);
const qa=await withModelSettings({provider:'extractive',model:'',effort:'default',creativity:'balanced'},()=>checkVideo(id,research,inventory,script,transcript,shots,recordings));
await writeArtifact(id,'qa.json',qa);
console.log(JSON.stringify({passed:qa.passed,failed:qa.checks.filter(c=>!c.passed),mp4:path.join(dir,'final.mp4')},null,2));
if(!qa.passed)throw new Error('Preview failed QA');
