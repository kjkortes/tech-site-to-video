import test from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { config } from '../src/lib/config';
import { jobDir } from '../src/lib/store';
import { probe, run } from '../src/lib/process';
import { launchBrowser, viewport } from '../src/pipeline/browser';
import { fitTitlesScript, pagePanel } from '../src/pipeline/video-layout';
import { editVideo } from '../src/pipeline/edit';
import { Shot, ShotResult, Transcript } from '../src/lib/types';

test('rendered portrait page fills the viewport with overlay identity and matching HTML framing', async () => {
  const originalDir = config.dataDir; const originalRenderer = config.renderer;
  config.dataDir = await mkdtemp(path.join(tmpdir(), 'frameforge-edit-')); config.renderer = 'ffmpeg';
  try {
    const id = randomUUID(); const dir = jobDir(id); await mkdir(dir, { recursive: true });
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=0x1556aa:s=${viewport.width}x${viewport.height}:r=30:d=1`, '-vf', 'drawbox=x=0:y=0:w=64:h=ih:color=red:t=fill,drawbox=x=iw-64:y=0:w=64:h=ih:color=lime:t=fill,drawbox=x=0:y=ih-64:w=iw:h=64:color=yellow:t=fill', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', path.join(dir, 'clip.mp4')]);
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '1', path.join(dir, 'narration.wav')]);
    const shots: Shot[] = [{ id: '001', sceneId: 'scene-1', start: 0, duration: 1, url: 'https://github.com/heygen-com/hyperframes', actions: [], caption: 'Old scene label' }];
    const recordings: ShotResult[] = [{ id: '001', clip: 'clip.mp4', duration: 1, trimStart: 0, attempts: 1, fallback: false, pageTitle: 'Fixture', captureMode: 'desktop', captureViewport: { ...viewport } }];
    const transcript: Transcript = { duration: 1, segments: [], timingSource: 'fixture', words: [{ text: 'Caption', start: .1, end: .9 }] };
    await editVideo(id, 'Ignored GitHub page title', shots, recordings, transcript);
    const info = await probe(path.join(dir, 'final.mp4'));
    assert.equal(info.streams.find(s => s.codec_type === 'video')?.width, 1080);
    assert.equal(info.streams.find(s => s.codec_type === 'video')?.height, 1920);
    assert.ok(info.streams.some(s => s.codec_type === 'audio'));
    assert.ok(Math.abs(Number(info.format.duration) - 1) < .1);
    const { stdout: pixels } = await promisify(execFile)('ffmpeg', ['-v', 'error', '-i', path.join(dir, 'poster.jpg'), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 7_000_000 });
    const rgb = (x: number, y: number) => [...pixels.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3)];
    assert.ok(rgb(pagePanel.x+15,500)[0] > 180 && rgb(pagePanel.x+15,500)[1] < 70, 'Left page edge must remain visible');
    assert.ok(rgb(pagePanel.x+pagePanel.width-15,500)[1] > 180 && rgb(pagePanel.x+pagePanel.width-15,500)[0] < 70, 'Right page edge must remain visible');
    assert.ok(rgb(500,pagePanel.y+pagePanel.height-30)[0] > 180 && rgb(500,pagePanel.y+pagePanel.height-30)[1] > 180, 'Bottom of the page must remain visible');
    assert.ok(rgb(2,1918)[0]>180 && rgb(2,1918)[1]>180,'Source fills the bottom corner without a decorative border');

    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
      await page.goto(pathToFileURL(path.join(dir, 'composition/index.html')).href);
      const frameHtml = await readFile(path.join(dir, 'composition/frames/frame-001.html'), 'utf8');
      await page.evaluate(html => { const template = new DOMParser().parseFromString(html, 'text/html').querySelector('template')!; document.querySelector('#frame-001')!.append(template.content.cloneNode(true)); }, frameHtml);
      await page.addScriptTag({ content: fitTitlesScript });
      const frame = await page.evaluate(() => ({
        title: document.querySelector('.title')!.textContent,
        chrome: document.querySelector('.chrome'),
        titleFits: document.querySelector('.title')!.scrollWidth <= document.querySelector('.title')!.clientWidth,
        page: (() => { const r = document.querySelector('video')!.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
      }));
      assert.equal(frame.title, 'heygen-com/hyperframes');
      assert.equal(frame.chrome,null);
      assert.ok(frame.titleFits); assert.deepEqual(frame.page, pagePanel);
      assert.doesNotMatch(await readFile(path.join(dir, 'composition/index.html'), 'utf8'), /Old scene label|Explore the project/);
      const caption=await page.locator('.caption span').boundingBox();assert.ok(caption && caption.x>=96 && caption.x+caption.width<=852 && caption.y>=1344 && caption.y+caption.height<=1536,'Actual rendered subtitle bounds respect the lower safe zone');
    } finally { await browser.close(); }
  } finally { await rm(config.dataDir, { recursive: true, force: true }); config.dataDir = originalDir; config.renderer = originalRenderer; }
});
