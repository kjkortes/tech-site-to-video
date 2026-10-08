import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { launchBrowser, newContext, navigate, inspectPage, dismissConsent, perform, captureMode, captureRevision, viewport } from './browser';
import { modelJson, modelEnabled } from '../lib/llm';
import { jobDir } from '../lib/store';
import { Research, Scene, Inventory, VisualAsset, browserActionSchema } from '../lib/types';

import { collectVisuals } from './visual-inventory';
import { directorRevision } from './direct';

export async function explore(id: string, research: Research): Promise<Inventory> {
  const dir = jobDir(id); await mkdir(path.join(dir, 'exploration'), { recursive: true });
  const browser = await launchBrowser(); const scenes: Scene[] = []; const notes: string[] = []; const assets: VisualAsset[] = [];
  try {
    const context = await newContext(browser); const page = await context.newPage();
    for (const source of research.sources) {
      try {
        await navigate(page, source.url); await dismissConsent(page);
        const info = await inspectPage(page);
        const overview: Scene = { id: `scene-${scenes.length + 1}`, sourceId: source.id, url: source.url, title: 'Product overview', description: info.description, actions: [], screenshot: `exploration/scene-${scenes.length + 1}.png` };
        assets.push(...await collectVisuals(id, page, overview, assets.length, notes));
        const candidates: { title: string; actions: Scene['actions'] }[] = [{ title: 'Product overview', actions: [] }, ...info.headings.filter(h => h.y > 250).slice(0, 3).map(h => ({ title: h.text, actions: [{ type: 'scroll' as const, text: h.text, y: h.y }] }))];
        if (modelEnabled()) {
          try {
            const plan = await modelJson('Choose up to 2 useful public demo interactions from these headings and controls. Return {scenes:[{title,actions:[{type:"click",text,role:"button"|"tab"|"link"} or {type:"scroll",text,y}]}]}. Only use existing controls. No authentication, downloads, form submissions, purchases or writes. Omit interactions if none are safe.', info, z.object({ scenes: z.array(z.object({ title: z.string().max(120), actions: z.array(browserActionSchema).max(3) })).max(2) }));
            candidates.push(...plan.scenes);
          } catch (error) { notes.push(`Model exploration unavailable: ${(error as Error).message}`); }
        }
        for (const candidate of candidates) {
          try {
            await navigate(page, source.url); await dismissConsent(page);
            for (const action of candidate.actions) await perform(page, action);
            const sceneId = `scene-${scenes.length + 1}`;
            const screenshot = `exploration/${sceneId}.png`;
            await page.screenshot({ path: path.join(dir, screenshot), animations: 'disabled' });
            const visible = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,p,li,pre')].filter(el => { const rect = el.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight; }).map(el => el.textContent || '').join(' '));
            scenes.push({ id: sceneId, url: source.url, title: candidate.title, actions: candidate.actions, screenshot, sourceId: source.id, description: visible.replace(/\s+/g, ' ').slice(0, 1600) });
          } catch (error) { notes.push(`Skipped ${candidate.title}: ${(error as Error).message}`); }
          if (scenes.length >= 12) break;
        }
      } catch (error) { notes.push(`Skipped page ${source.url}: ${(error as Error).message}`); }
      if (scenes.length >= 12) break;
    }
    // Probe a small number of actual demo targets during exploration; their replay is independent.
    for (const asset of assets.filter(a=>a.type === 'demo').slice(0,2)) {
      const demoContext = await newContext(browser);
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
  return { scenes, assets, directorRevision, notes, captureMode, captureRevision, captureViewport: { ...viewport } };
}

// Keep scene identities and scripts when an existing job switches capture mode.
// Refresh its fallback images using the same desktop viewport as the clean replay.
export async function refreshInventoryCapture(id: string, inventory: Inventory): Promise<Inventory> {
  const browser = await launchBrowser(); const assets: VisualAsset[] = []; const notes = [...inventory.notes];
  try {
    const context = await newContext(browser); const page = await context.newPage();
    for (const scene of inventory.scenes) {
      try {
      await navigate(page, scene.url); await dismissConsent(page);
      if (!scene.actions.length) assets.push(...await collectVisuals(id, page, scene, assets.length, notes));
      for (const action of scene.actions) await perform(page, action);
      await page.screenshot({ path: path.join(jobDir(id), scene.screenshot), animations: 'disabled' });
      } catch (error) { notes.push(`Retained ${scene.id} fallback after refresh failed: ${(error as Error).message}`); }
    }
    return { ...inventory, assets, notes, directorRevision, captureMode, captureRevision, captureViewport: { ...viewport } };
  } finally { await browser.close(); }
}
