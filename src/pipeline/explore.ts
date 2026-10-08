import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { launchBrowser, newContext, navigate, inspectPage, dismissConsent, perform, captureMode, captureRevision, viewport, positionAtSection } from './browser';
import { jobDir } from '../lib/store';
import { Research, Scene, Inventory, VisualAsset, ContentMode } from '../lib/types';

import { collectVisuals } from './visual-inventory';
import { directorRevision } from './direct';
import { mapDocument, mapRevision, locationFor } from './document-map';
import type { DocumentPage } from '../lib/types';

export async function explore(id: string, research: Research, contentMode:ContentMode='promotional'): Promise<Inventory> {
  const dir = jobDir(id); await mkdir(path.join(dir, 'exploration'), { recursive: true });
  const browser = await launchBrowser(); const scenes: Scene[] = []; const notes: string[] = []; const assets: VisualAsset[] = []; const pages: DocumentPage[] = [];
  try {
    const context = await newContext(browser,undefined,contentMode); const page = await context.newPage();
    for (const source of research.sources.filter(s=>!new URL(s.url).pathname.includes('/commit/'))) {
      try {
        await navigate(page, source.url); await dismissConsent(page);
        const info = await inspectPage(page);
        const overview: Scene = { id: `scene-${scenes.length + 1}`, sourceId: source.id, url: source.url, title: 'Product overview', description: info.description, actions: [], screenshot: `exploration/scene-${scenes.length + 1}.png` };
        const documentMap=await mapDocument(page,source.id,`page-${source.id}`,pages.length);pages.push(documentMap);
        assets.push(...await collectVisuals(id, page, overview, assets.length, notes));
        const candidates = documentMap.sections.map(section=>({title:section.heading,sectionId:section.id,actions:[{type:'scroll' as const,text:section.heading,y:section.scrollY}]}));
        for (const candidate of candidates) {
          try {
            const section=documentMap.sections.find(s=>s.id===candidate.sectionId)!;
            await positionAtSection(page,locationFor(documentMap,section));
            const sceneId = `scene-${scenes.length + 1}`;
            const screenshot = `exploration/${sceneId}.png`;
            await page.screenshot({ path: path.join(dir, screenshot), animations: 'disabled' });
            const visible = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,p,li,pre')].filter(el => { const rect = el.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight; }).map(el => el.textContent || '').join(' '));
            scenes.push({ id: sceneId, url: source.url, title: candidate.title, sectionId: candidate.sectionId, actions: candidate.actions, screenshot, sourceId: source.id, description: visible.replace(/\s+/g, ' ').slice(0, 1600) });
          } catch (error) { notes.push(`Skipped ${candidate.title}: ${(error as Error).message}`); }

        }
      } catch (error) { notes.push(`Skipped page ${source.url}: ${(error as Error).message}`); }

    }
    // Probe a small number of actual demo targets during exploration; their replay is independent.
    for (const asset of assets.filter(a=>a.type === 'demo').slice(0,2)) {
      const demoContext = await newContext(browser,undefined,contentMode);
      try {
        const demo = await demoContext.newPage(); await navigate(demo, asset.pageUrl); await dismissConsent(demo);
        for (const action of asset.actions || []) await perform(demo, action);
        const info = await inspectPage(demo); asset.description = `${asset.description} ${info.description} ${info.text.slice(0,700)}`;
        asset.localPath = `assets/${asset.id}.png`; await demo.screenshot({path:path.join(dir,asset.localPath),animations:'disabled'});
        asset.width = viewport.width; asset.height = viewport.height; asset.quality = .7; asset.confidence = .85;
      } catch (error) { asset.confidence = .2; notes.push(`Demo ${asset.id} unavailable: ${(error as Error).message}`); }
      finally { await demoContext.close(); }
    }
  } finally { await browser.close(); }
  if (!scenes.length) throw new Error('No accessible visuals were found. Try a public documentation page.');
  associateDocumentAssets(pages,scenes,assets);
  return { pages,mapRevision,scenes, assets, directorRevision, notes, captureMode, captureRevision, captureViewport: { ...viewport } };
}

// Keep scene identities and scripts when an existing job switches capture mode.
// Refresh its fallback images using the same desktop viewport as the clean replay.
export async function refreshInventoryCapture(id: string, inventory: Inventory): Promise<Inventory> {
  const browser = await launchBrowser(); const assets: VisualAsset[] = []; const notes = [...inventory.notes]; const pages: DocumentPage[]=[];
  // Old section indexes can collide with new ones after excluding repository chrome.
  // Rebind only matched scenes; keep unmatched legacy fallbacks without map ownership.
  const scenes=inventory.scenes.map(s=>({...s,sectionId:undefined as string|undefined}));
  try {
    const context = await newContext(browser,undefined,inventory.contentMode); const page = await context.newPage();
    const sources=[...new Map(inventory.scenes.filter(s=>!new URL(s.url).pathname.includes('/commit/')).map(s=>[s.url,s])).values()];
    for(const source of sources) {
      await navigate(page,source.url);await dismissConsent(page);
      const documentMap=await mapDocument(page,source.sourceId||source.id,`page-${source.sourceId||source.id}`,pages.length);pages.push(documentMap);
      assets.push(...await collectVisuals(id,page,source,assets.length,notes));
      for(const section of documentMap.sections) {
        let scene=scenes.find(s=>s.sourceId===source.sourceId && s.title===section.heading);
        if(scene) {scene.sectionId=section.id;scene.actions=[{type:'scroll',text:section.heading,y:section.scrollY}];scene.description=section.text.slice(0,1600);}
        if(!scene) {const sceneId=`scene-${scenes.length+1}`;scene={id:sceneId,sourceId:source.sourceId,sectionId:section.id,url:source.url,title:section.heading,description:section.text.slice(0,1600),actions:[{type:'scroll',text:section.heading,y:section.scrollY}],screenshot:`exploration/${sceneId}.png`};scenes.push(scene);}
        try {
          await positionAtSection(page,locationFor(documentMap,section));
          await page.screenshot({ path:path.join(jobDir(id),scene.screenshot),animations:'disabled' });
        } catch(error) {notes.push(`Retained ${scene.id} fallback after refresh failed: ${(error as Error).message}`);}
      }
    }
    associateDocumentAssets(pages,scenes,assets);
    return { ...inventory, pages,mapRevision,scenes,assets, notes, directorRevision, captureMode, captureRevision, captureViewport: { ...viewport } };
  } finally { await browser.close(); }
}

function associateDocumentAssets(pages: DocumentPage[],scenes: Scene[],assets: VisualAsset[]) {
  for(const section of pages.flatMap(p=>p.sections)) {
    section.sceneId=scenes.find(s=>s.sectionId===section.id)?.id;
    section.assetIds=assets.filter(a=>a.sectionId===section.id).map(a=>a.id);
    for(const asset of assets.filter(a=>a.sectionId===section.id)) if(section.sceneId) asset.sceneId=section.sceneId;
  }
}
