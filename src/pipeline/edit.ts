import path from 'node:path';
import { mkdir, writeFile, copyFile, rename, stat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { config } from '../lib/config';
import { jobDir, atomicJson } from '../lib/store';
import { Shot, ShotResult, Transcript } from '../lib/types';
import { run, probe } from '../lib/process';
import { directedCaptions, toAss, toSrt } from './captions';
import { launchBrowser } from './browser';
import { verticalSafeArea } from './safe-area';
import { codeVisualsAllowed } from './content-policy';
import { escapeHtml, frameStyles, frameMarkup, fitTitlesScript, panelFor } from './video-layout';

const require = createRequire(import.meta.url);
export async function buildComposition(id: string, title: string, shots: Shot[], recordings: ShotResult[], transcript: Transcript) {
  if(shots.some(s=>s.type==='code_focus' && !codeVisualsAllowed(s.contentMode)))throw new Error('Promotional render rejects code visuals');
  const dir = jobDir(id); const composition = path.join(dir, 'composition'); await mkdir(composition, { recursive: true });
  await copyFile(require.resolve('gsap/dist/gsap.min.js'), path.join(composition, 'gsap.min.js'));
  await copyFile(path.join(dir, 'narration.wav'), path.join(composition, 'narration.wav'));
  await mkdir(path.join(composition, 'frames'), { recursive: true });
  const markup: string[] = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]; const recording = recordings.find(r => r.id === shot.id);
    if (!recording) throw new Error(`Missing clip ${shot.id}`);
    const panel = panelFor(shot.framing);
    const filename = `shot-${shot.id}${path.extname(recording.clip)}`;
    await copyFile(path.join(dir, recording.clip), path.join(composition, filename));
    const frameId = `frame-${shot.id}`;
    const styles = frameStyles.replace(/body\{[^}]*\}|#root\{[^}]*\}/g, '');
    await writeFile(path.join(composition, 'frames', `${frameId}.html`), `<!doctype html><html><body><template><style>${styles}</style><div id="${frameId}-content" data-composition-id="${frameId}" data-start="0" data-duration="${shot.duration}" data-width="1080" data-height="1920" style="position:absolute;inset:0;width:1080px;height:1920px;font-family:Arial,sans-serif;color:#eef4ff">${frameMarkup(title, shot.url, frameId, shots[0].url, shot.framing, shot.walkthrough?.location.heading, shot.start<3 || shot.walkthrough?.role==='ending')}</div><script>${fitTitlesScript}window.__timelines=window.__timelines||{};window.__timelines['${frameId}']=gsap.timeline({paused:true});</script></template></body></html>`);
    markup.push(`<video id="media-${shot.id}" class="clip browser-video" style="left:${panel.x}px;top:${panel.y}px;width:${panel.width}px;height:${panel.height}px" src="${filename}" data-start="${shot.start}" data-duration="${shot.duration}" data-media-start="${recording.trimStart}" data-track-index="1" muted playsinline></video><div id="${frameId}" class="clip" data-composition-id="${frameId}" data-composition-src="frames/${frameId}.html" data-start="${shot.start}" data-duration="${shot.duration}" data-track-index="2" data-width="1080" data-height="1920"></div>`);
  }
  const captions = directedCaptions(transcript, shots).map((c, i) => `<div id="caption-${i}" class="clip caption caption-${c.position}" data-start="${c.start}" data-duration="${c.end - c.start}" data-track-index="3"><span style=\"font-size:${c.fontSize}px\">${(c.lines||[c.text]).map(escapeHtml).join('<br>')}</span></div>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=1080,height=1920"><title>${escapeHtml(title)}</title><script src="gsap.min.js"></script><style>
${frameStyles}
.clip{position:absolute;inset:0}.browser-video{inset:auto;object-fit:contain;background:#0c1b35}.caption{inset:auto;left:96px;top:1344px;width:756px;height:192px;display:flex;align-items:flex-end;justify-content:center;box-sizing:border-box;padding:0 16px 24px;pointer-events:none}.caption span{background:#1c2436e8;border-radius:12px;padding:8px 16px;font-family:DejaVu Sans,sans-serif;font-weight:700;line-height:1.2;text-align:center;max-width:724px;box-sizing:border-box}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="${transcript.duration}" data-fps="30">${markup.join('')}${captions}<audio id="narration" class="clip" src="narration.wav" data-start="0" data-duration="${transcript.duration}" data-track-index="4"></audio></div><script>${fitTitlesScript}window.__timelines={main:gsap.timeline({paused:true})};</script></body></html>`;
  await writeFile(path.join(composition,'safe-area.json'),JSON.stringify(verticalSafeArea,null,2));
  await writeFile(path.join(composition, 'index.html'), html);
  await writeFile(path.join(composition, 'hyperframes.json'), JSON.stringify({ name: 'tech-demo', entry: 'index.html', width: 1080, height: 1920, fps: 30 }, null, 2));
  return composition;
}
export async function editVideo(id: string, title: string, shots: Shot[], recordings: ShotResult[], transcript: Transcript) {
  const dir = jobDir(id); const render = path.join(dir, 'render'); await mkdir(render, { recursive: true });
  const captions = directedCaptions(transcript, shots);
  await writeFile(path.join(dir, 'captions.srt'), toSrt(captions));
  await writeFile(path.join(dir, 'captions.ass'), toAss(captions));
  const composition = await buildComposition(id, title, shots, recordings, transcript);
  const temporary = path.join(dir, 'final.partial.mp4');
  if (config.renderer === 'hyperframes') {
    const bin = path.resolve('node_modules/.bin/hyperframes');
    await run(bin, ['check', '--json'], { cwd: composition });
    const hfOutput = path.join(dir, 'hyperframes.partial.mp4');
    await run(bin, ['render', '--quality', 'high', '--output', hfOutput], { cwd: composition, timeout: 1800000 });
    await run('ffmpeg', ['-y', '-i', hfOutput, '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-b:a', '192k', '-movflags', '+faststart', temporary]);
  } else {
    // Rasterize the exact same frame HTML as HyperFrames. The transparent page
    // opening preserves browser footage edge to edge in both renderers.
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      for (const shot of shots) {
        await page.setContent(`<!doctype html><html><head><style>${frameStyles}</style></head><body><div id="root">${frameMarkup(title, shot.url, 'frame', shots[0].url, shot.framing, shot.walkthrough?.location.heading, shot.start<3 || shot.walkthrough?.role==='ending')}</div><script>${fitTitlesScript}</script></body></html>`);
        await page.screenshot({ path: path.join(render, `frame-${shot.id}.png`), omitBackground: true });
      }
    } finally { await browser.close(); }
    const checkpointFile = path.join(render, 'progress.json');
    const checkpoint: Record<string,string> = await readFile(checkpointFile,'utf8').then(JSON.parse).catch(()=>({}));
    for (const shot of shots) {
      const recording = recordings.find(r => r.id === shot.id);
      if (!recording) throw new Error(`Missing clip ${shot.id}`);
      const sourceStat = await stat(path.join(dir, recording.clip));
      const signature = createHash('sha256').update(JSON.stringify({ shot, recording, title, size: sourceStat.size, mtime: sourceStat.mtimeMs, frame: frameStyles + frameMarkup(title, shot.url, 'frame', shots[0].url, shot.framing, shot.walkthrough?.location.heading, shot.start<3 || shot.walkthrough?.role==='ending') })).digest('hex');
      const expectedFrames = Math.max(1, Math.round((shot.start + shot.duration)*30) - Math.round(shot.start*30));
      if (checkpoint[shot.id] === signature) {
        const info = await probe(path.join(render,`${shot.id}.mp4`)).catch(()=>null);
        if (info && Math.abs(Number(info.format.duration)-expectedFrames/30)<.05) continue;
      }
      // All filter paths are fixed relative filenames, never user supplied shell/filter syntax.
      const pagePanel = panelFor(shot.framing);
      const filter = `[0:v]scale=${pagePanel.width}:${pagePanel.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${pagePanel.width}:${pagePanel.height}:(ow-iw)/2:(oh-ih)/2:color=0x0c1b35,setsar=1[page];[page][1:v]overlay=0:0:format=auto,format=yuv420p,setsar=1[out]`;
      await run('ffmpeg', ['-y', '-ss', String(recording.trimStart), '-i', path.join(dir, recording.clip), '-i', `frame-${shot.id}.png`, '-frames:v', String(expectedFrames), '-filter_complex', filter, '-map', '[out]', '-r', '30', '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', `${shot.id}.mp4`], { cwd: render });
      checkpoint[shot.id] = signature; await atomicJson(checkpointFile, checkpoint);
    }
    await writeFile(path.join(render, 'concat.txt'), shots.map(s => `file '${s.id}.mp4'`).join('\n'));
    await copyFile(path.join(dir, 'captions.ass'), path.join(render, 'captions.ass'));
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '1', '-i', 'concat.txt', '-i', path.join(dir, 'narration.wav'), '-vf', 'ass=captions.ass', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(transcript.duration), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', temporary], { cwd: render });
  }
  await rename(temporary, path.join(dir, 'final.mp4'));
  await run('ffmpeg', ['-y', '-ss', String(Math.min(2, transcript.duration / 2)), '-i', path.join(dir, 'final.mp4'), '-frames:v', '1', '-update', '1', path.join(dir, 'poster.jpg')]);
}
