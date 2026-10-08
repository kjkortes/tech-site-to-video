import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { Inventory, Shot, ShotResult } from '../lib/types';
import { jobDir, readArtifact, writeArtifact } from '../lib/store';
import { launchBrowser, newContext, navigate, dismissConsent, perform, recordingSize, captureMode, captureRevision, viewport, matchesCapture } from './browser';
import { probe, run } from '../lib/process';

export async function recordShots(id: string, shots: Shot[], inventory: Inventory, onProgress: (detail: string) => Promise<void>): Promise<ShotResult[]> {
  const dir = jobDir(id); const clips = path.join(dir, 'clips'); await mkdir(clips, { recursive: true });
  const saved = await readArtifact<ShotResult[]>(id, 'recordings.json').catch(() => []);
  const results: ShotResult[] = []; const browser = await launchBrowser();
  try {
    for (const shot of shots) {
      const previous = saved.find(r => r.id === shot.id);
      if (previous && matchesCapture(previous) && await stat(path.join(dir, previous.clip)).then(s => s.size > 0).catch(() => false)) {
        const info = await probe(path.join(dir, previous.clip)).catch(() => null);
        if (info && Number(info.format.duration) >= previous.trimStart + shot.duration - 0.2) { results.push(previous); continue; }
      }
      let result: ShotResult | undefined;
      for (let attempt = 1; attempt <= 2; attempt++) {
        await onProgress(`Recording shot ${Number(shot.id)} of ${shots.length}${attempt > 1 ? ' · retrying' : ''}`);
        const context = await newContext(browser, clips); const page = await context.newPage(); const video = page.video();
        try {
          const opened = Date.now();
          await navigate(page, shot.url); await dismissConsent(page);
          for (const action of shot.actions) await perform(page, action);
          await page.waitForTimeout(600);
          const trimStart = (Date.now() - opened) / 1000;
          const pageTitle = await page.title();
          // Smooth, bounded scroll keeps genuine browser footage moving, without altering voice timing.
          const startY = await page.evaluate(() => window.scrollY);
          const travel = await page.evaluate(() => Math.max(0, Math.min(220, document.documentElement.scrollHeight - window.innerHeight - window.scrollY)));
          const steps = Math.max(1, Math.ceil((shot.duration + 0.7) * 10));
          for (let tick = 0; tick < steps; tick++) {
            await page.evaluate(y => window.scrollTo(0, y), startY + travel * tick / steps);
            await page.waitForTimeout(100);
          }
          await context.close();
          const clip = `clips/${shot.id}.webm`;
          if (!video) throw new Error('Browser recording was not created');
          await video.saveAs(path.join(dir, clip)); await video.delete();
          const info = await probe(path.join(dir, clip));
          if (Number(info.format.duration) < trimStart + shot.duration - 0.2) throw new Error('Recorded shot is too short');
          result = { id: shot.id, clip, trimStart, duration: shot.duration, attempts: attempt, fallback: false, pageTitle, captureMode, captureRevision, captureViewport: { ...viewport } };
          break;
        } catch (error) {
          await context.close().catch(() => {}); await video?.delete().catch(() => {});
          await onProgress(`Shot ${Number(shot.id)}: ${(error as Error).message.slice(0, 180)}`);
        }
      }
      if (!result) {
        const scene = inventory.scenes.find(s => s.id === shot.sceneId);
        if (!scene) throw new Error('No discovered fallback visual');
        const clip = `clips/${shot.id}.mp4`;
        // An already discovered screenshot is a supporting visual, never exploration footage.
        await run('ffmpeg', ['-y', '-loop', '1', '-i', path.join(dir, scene.screenshot), '-vf', `scale=${recordingSize.width}:${recordingSize.height},zoompan=z='1+0.0002*on':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${recordingSize.width}x${recordingSize.height}:fps=30`, '-t', String(shot.duration + 1), '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(dir, clip)]);
        result = { id: shot.id, clip, trimStart: 0, duration: shot.duration, attempts: 2, fallback: true, pageTitle: scene.title, captureMode, captureRevision, captureViewport: { ...viewport } };
      }
      results.push(result);
      // Save every shot immediately so process death never discards successful recording work.
      await writeArtifact(id, 'recordings.json', [...results, ...saved.filter(r => !results.some(v => v.id === r.id))]);
    }
  } finally { await browser.close(); }
  await writeArtifact(id, 'recordings.json', results); return results;
}
