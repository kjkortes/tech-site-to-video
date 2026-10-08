import path from 'node:path';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { Inventory, Shot, ShotResult } from '../lib/types';
import { jobDir, readArtifact, writeArtifact } from '../lib/store';
import { launchBrowser, newContext, navigate, dismissConsent, perform, consentObscuresPage, captureMode, captureRevision, viewport, matchesCapture, positionAtSection, scrollToSection } from './browser';
import { probe, run } from '../lib/process';
import { createHash } from 'node:crypto';
import { assetsFor } from './direct';
import { renderCameraClip } from './camera';
import { generatedScene } from './generated-scenes';
import { captureSourceCode } from './source-code';
import { codeVisualsAllowed, promotionalCaptureCSS } from './content-policy';

export function shotSignature(shot: Shot) { return createHash('sha256').update(JSON.stringify(shot)).digest('hex'); }

export async function recordShots(id: string, shots: Shot[], inventory: Inventory, onProgress: (detail: string) => Promise<void>): Promise<ShotResult[]> {
  if(shots.some(s=>s.type==='code_focus' || assetsFor(inventory).find(a=>a.id===s.assetId)?.type==='code') && !codeVisualsAllowed(inventory.contentMode))throw new Error('Promotional capture rejects code visuals');
  const dir = jobDir(id); const clips = path.join(dir, 'clips'); await mkdir(clips, { recursive: true });
  const saved = await readArtifact<ShotResult[]>(id, 'recordings.json').catch(() => []);
  const results: ShotResult[] = []; const browser = await launchBrowser();
  try {
    for (const shot of shots) {
      const signature = shotSignature(shot);
      const asset = assetsFor(inventory).find(a => a.id === shot.assetId);
      const previous = saved.find(r => r.id === shot.id && r.signature === signature);
      if (previous && matchesCapture(previous) && await stat(path.join(dir, previous.clip)).then(s => s.size > 0).catch(() => false)) {
        const info = await probe(path.join(dir, previous.clip)).catch(() => null);
        if (info && Number(info.format.duration) >= previous.trimStart + shot.duration - 0.2) { results.push(previous); continue; }
      }
      let result: ShotResult | undefined; let lastError = '';
      const assetShot = shot.type && !['walkthrough', 'establish', 'scroll_to', 'click_demo'].includes(shot.type);
      if (assetShot) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          await onProgress(`Capturing ${shot.type} shot ${shot.id} of ${shots.length}${attempt > 1 ? ' · retrying' : ''}`);
          try {
            if (!asset) throw new Error('Selected visual asset is missing');
            let source = asset.localPath ? path.join(dir, asset.localPath) : undefined;
            let generated=false,codeFallback:string|undefined;
            if(shot.type==='code_focus' && source && !await stat(source).then(s=>s.size>0).catch(()=>false)){source=undefined;codeFallback='Stored source-code image is unavailable';}
            if(shot.type==='code_focus' && (!source || !await stat(source).then(s=>s.size>0).catch(()=>false)) && asset.selector) {
              const context=await newContext(browser);
              try {
                const page=await context.newPage();await navigate(page,asset.pageUrl);await dismissConsent(page);
                if(await consentObscuresPage(page))throw new Error('Consent dialog obscures source code');
                source=path.join(clips,`${shot.id}-actual-code.png`);
                const metadata=await captureSourceCode(page,asset.selector,source),info=await probe(source),stream=info.streams.find(s=>s.codec_type==='video')!;
                asset.width=stream.width!;asset.height=stream.height!;asset.code={fontSize:metadata.fontSize*asset.width/metadata.width,lines:metadata.lines};
              }catch(error){codeFallback=(error as Error).message;source=undefined;}finally{await context.close();}
            }
            if (shot.type==='diagram' || shot.type==='code_focus' && !source) {
              generated=true;if(shot.type==='code_focus')codeFallback||='No usable source-code capture or stored selector';
              const context = await browser.newContext({ viewport: { width: 972, height: 1130 }, deviceScaleFactor: 2 });
              try {
                const page = await context.newPage();
                const documentFor = (visibleNodes = Infinity) => `<!doctype html><style>body{margin:0;background:#0c1b35;color:#eef4ff}*{box-sizing:border-box}</style>${generatedScene(shot, asset, visibleNodes)}`;
                await page.setContent(documentFor()); source = path.join(clips, `${shot.id}-source.png`); await page.screenshot({ path: source });
                if (shot.type === 'diagram' && shot.diagram) {
                  const poses: string[] = []; const nodes = shot.diagram.nodes.length;
                  const reveal = Math.min(.5, shot.duration / (nodes + 1));
                  for (let count = 1; count <= nodes; count++) {
                    const file = `${shot.id}-diagram-${count}.png`; await page.setContent(documentFor(count)); await page.screenshot({path:path.join(clips,file)});
                    poses.push(`file '${file}'`, `duration ${count === nodes ? shot.duration - (nodes - 1) * reveal : reveal}`);
                  }
                  poses.push(`file '${shot.id}-diagram-${nodes}.png'`);
                  await writeFile(path.join(clips,`${shot.id}-diagram.txt`),poses.join('\n'));
                  source = path.join(clips,`${shot.id}-diagram.mp4`);
                  await run('ffmpeg',['-y','-f','concat','-safe','1','-i',`${shot.id}-diagram.txt`,'-t',String(shot.duration),'-r','30','-an','-c:v','libx264','-threads','2','-preset','veryfast','-pix_fmt','yuv420p',source],{cwd:clips});
                }
              }
              finally { await context.close(); }
            } else if (asset.type === 'section') {
              const context = await newContext(browser);
              try { const page = await context.newPage(); await navigate(page, asset.pageUrl); await dismissConsent(page); if(!codeVisualsAllowed(inventory.contentMode))await page.addStyleTag({content:promotionalCaptureCSS}); if (await consentObscuresPage(page)) throw new Error('Consent dialog obscures the source'); for (const action of asset.actions || []) await perform(page, action); source = path.join(clips, `${shot.id}-source.png`); if (asset.selector) await page.locator(asset.selector).screenshot({ path: source, animations: 'disabled', timeout: 7000 }); else await page.screenshot({ path: source, animations: 'disabled' }); }
              finally { await context.close(); }
            }
            if (!source) throw new Error('Visual has no captured source');
            const clip = `clips/${shot.id}.mp4`;
            await renderCameraClip(source, path.join(dir, clip), shot, ['video','gif'].includes(asset.type) || shot.type === 'diagram', ['video','gif'].includes(asset.type)?shot.sourceOffset||0:0,!generated?asset:undefined,shot.contextPreview?path.join(dir,shot.contextPreview):undefined);
            result = { id: shot.id, signature, kind: generated ? 'generated' : 'asset', clip, trimStart: 0, duration: shot.duration, attempts: attempt, fallback: !!codeFallback, fallbackReason:codeFallback, mediaIsolation: !generated && ['image','gif','video'].includes(asset.type)?{assetId:asset.id,method:asset.captureMethod||'stored-media',layers:1}:undefined, pageTitle: asset.description, captureMode, captureRevision, captureViewport: { ...viewport } };
            break;
          } catch (error) { lastError = (error as Error).message; await onProgress(`Shot ${shot.id}: ${lastError.slice(0,180)}`); }
        }
      }
      if (!assetShot) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          await onProgress(`Recording shot ${Number(shot.id)} of ${shots.length}${attempt > 1 ? ' · retrying' : ''}`);
          const context = await newContext(browser, clips); const page = await context.newPage(); const video = page.video();
          try {
            const opened = Date.now();
            await navigate(page, shot.url); await dismissConsent(page);
            if(!codeVisualsAllowed(inventory.contentMode))await page.addStyleTag({content:promotionalCaptureCSS});
            const liveClick = shot.type === 'click_demo' ? shot.actions.findLast(a => a.type === 'click') : undefined;
            for (const action of shot.actions) if (action !== liveClick) await perform(page, action);
            if(shot.type==='walkthrough' && shot.walkthrough) await positionAtSection(page,shot.walkthrough.transition?.from||shot.walkthrough.location);
            await page.waitForTimeout(600);
            const trimStart = (Date.now() - opened) / 1000;
            const pageTitle = await page.title();
            const consentObscured = await consentObscuresPage(page);
            if (consentObscured) throw new Error('Consent dialog obscures the source');
            if (liveClick) await perform(page, liveClick);
            if(shot.type==='walkthrough' && shot.walkthrough?.transition) {
              await scrollToSection(page,shot.walkthrough.location,shot.walkthrough.transition.duration);
              await page.waitForTimeout(Math.max(0,shot.duration-shot.walkthrough.transition.duration+.7)*1000);
            } else if (shot.type === 'scroll_to') {
              const startY = await page.evaluate(() => scrollY);
              const travel = await page.evaluate(() => Math.max(0, Math.min(300, document.documentElement.scrollHeight - innerHeight - scrollY)));
              const ticks = Math.max(1, Math.ceil(Math.min(3, shot.duration) * 30));
              for (let tick = 0; tick < ticks; tick++) { await page.evaluate(y => scrollTo(0, y), startY + travel * tick / ticks); await page.waitForTimeout(1000 / 30); }
              await page.waitForTimeout(700);
            } else await page.waitForTimeout((shot.duration + .7) * 1000);
            await context.close();
            const clip = `clips/${shot.id}.webm`;
            if (!video) throw new Error('Browser recording was not created');
            await video.saveAs(path.join(dir, clip)); await video.delete();
            const info = await probe(path.join(dir, clip));
            if (Number(info.format.duration) < trimStart + shot.duration - 0.2) throw new Error('Recorded shot is too short');
            let outputClip = clip;
            if (shot.cameraMode === 'detail') {
              outputClip = `clips/${shot.id}-camera.mp4`;
              await renderCameraClip(path.join(dir,clip),path.join(dir,outputClip),shot,true,trimStart,asset,shot.contextPreview?path.join(dir,shot.contextPreview):undefined);
            }
            result = { id: shot.id, signature, rawClip: clip, rawTrimStart: trimStart, kind: 'browser', consentObscured: false, clip: outputClip, trimStart: outputClip === clip ? trimStart : 0, duration: shot.duration, attempts: attempt, fallback: false, pageTitle, captureMode, captureRevision, captureViewport: { ...viewport } };
            break;
          } catch (error) {
            await context.close().catch(() => {}); await video?.delete().catch(() => {});
            lastError = (error as Error).message; await onProgress(`Shot ${Number(shot.id)}: ${lastError.slice(0, 180)}`);
          }
        }
      }
      if (!result) {
        if(assetShot && asset && ['image','gif','video'].includes(asset.type))throw new Error(`Isolated media ${asset.id} could not be captured: ${lastError}`);
        if(!codeVisualsAllowed(inventory.contentMode))throw new Error(`Promotional capture failed after retries; refusing an unchecked page/code fallback: ${lastError}`);
        const scene = inventory.scenes.find(s => s.id === shot.sceneId);
        if (!scene) throw new Error('No discovered fallback visual');
        const clip = `clips/${shot.id}.mp4`;
        // An already discovered screenshot is a supporting visual, never exploration footage.
        await renderCameraClip(path.join(dir, scene.screenshot), path.join(dir, clip), { ...shot, highlight: undefined, focus: undefined, motion: 'slow-push' });
        result = { id: shot.id, signature, kind: 'asset', fallbackReason: lastError, clip, trimStart: 0, duration: shot.duration, attempts: 2, fallback: true, pageTitle: scene.title, captureMode, captureRevision, captureViewport: { ...viewport } };
      }
      results.push(result);
      // Save every shot immediately so process death never discards successful recording work.
      await writeArtifact(id, 'recordings.json', [...results, ...saved.filter(r => !results.some(v => v.id === r.id))]);
    }
  } finally { await browser.close(); }
  await writeArtifact(id, 'recordings.json', results); return results;
}
