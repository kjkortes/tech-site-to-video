import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { launchBrowser, newContext, navigate, inspectPage, dismissConsent, perform, captureMode } from './browser';
import { config } from '../lib/config';
import { modelJson, modelEnabled } from '../lib/llm';
import { jobDir } from '../lib/store';
import { Research, Scene, Inventory, browserActionSchema } from '../lib/types';

export async function explore(id: string, research: Research): Promise<Inventory> {
  const dir = jobDir(id); await mkdir(path.join(dir, 'exploration'), { recursive: true });
  const browser = await launchBrowser(); const scenes: Scene[] = []; const notes: string[] = [];
  try {
    const context = await newContext(browser); const page = await context.newPage();
    for (const source of research.sources) {
      try {
        await navigate(page, source.url); await dismissConsent(page);
        const info = await inspectPage(page);
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
  } finally { await browser.close(); }
  if (!scenes.length) throw new Error('No accessible visuals were found. Try a public documentation page.');
  return { scenes, notes, captureMode };
}

// Keep scene identities and scripts when an existing job switches capture mode.
// Refresh its fallback images using the same mobile browser as the clean replay.
export async function refreshInventoryCapture(id: string, inventory: Inventory): Promise<Inventory> {
  const browser = await launchBrowser();
  try {
    const context = await newContext(browser); const page = await context.newPage();
    for (const scene of inventory.scenes) {
      await navigate(page, scene.url); await dismissConsent(page);
      for (const action of scene.actions) await perform(page, action);
      await page.screenshot({ path: path.join(jobDir(id), scene.screenshot), animations: 'disabled' });
    }
    return { ...inventory, captureMode };
  } finally { await browser.close(); }
}
