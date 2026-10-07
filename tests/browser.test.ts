import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchBrowser, newContext, perform } from '../src/pipeline/browser';
import { probe, run } from '../src/lib/process';

test('vertical capture uses a touch mobile layout and fills the recorded frame', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'frameforge-mobile-'));
  const browser = await launchBrowser();
  try {
    const context = await newContext(browser, directory);
    await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#1556aa}main{width:70%;height:100%;background:#1556aa}@media(max-width:600px){main{width:100%}}</style><main>Mobile demo</main>` }));
    const page = await context.newPage(); await page.goto('https://example.com/');
    const layout = await page.evaluate(() => ({
      mobile: matchMedia('(max-width:600px)').matches,
      touch: navigator.maxTouchPoints > 0,
      mobileAgent: /Android|Mobile/.test(navigator.userAgent),
      width: innerWidth,
      contentWidth: document.querySelector('main')!.getBoundingClientRect().width,
    }));
    assert.ok(layout.mobile, 'Vertical demos must activate mobile responsive breakpoints');
    assert.ok(layout.touch, 'Capture should emulate a touch device');
    assert.ok(layout.mobileAgent, 'Sites must receive a mobile user agent');
    assert.equal(layout.contentWidth, layout.width, 'Responsive content should fill the viewport');
    await page.waitForTimeout(1200);
    const video = page.video()!; await context.close();
    const file = await video.path(); const info = await probe(file);
    const stream = info.streams.find(s => s.codec_type === 'video')!;
    assert.ok(Math.abs(stream.width! / stream.height! - 990 / 1226) < 0.005, 'Capture must fit the browser panel without side padding');
    const edge = await run('ffmpeg', ['-v', 'error', '-ss', '0.8', '-i', file, '-vf', `crop=20:${stream.height}:${stream.width! - 20}:0,signalstats,metadata=print:file=-`, '-frames:v', '1', '-f', 'null', '-']);
    const luma = Number(/lavfi.signalstats.YAVG=([\d.]+)/.exec(edge)?.[1]);
    assert.ok(luma > 40 && luma < 110, `The right edge should contain the page, not white/black padding (luma ${luma})`);
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});

test('mobile replay skips hidden desktop sidebar targets', async () => {
  const browser = await launchBrowser();
  try {
    const context = await newContext(browser); const page = await context.newPage();
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div style="display:none">File tree</div><div style="height:1500px"></div><p>File tree</p>');
    await perform(page, { type: 'scroll', text: 'File tree', y: 392 });
    assert.ok(await page.evaluate(() => window.scrollY > 1000), 'Replay must find the visible mobile target after the hidden desktop duplicate');
    await page.setContent('<div style="display:none">Desktop sidebar</div><div style="height:1500px"></div>');
    await perform(page, { type: 'scroll', text: 'Desktop sidebar', y: 392 });
    assert.equal(await page.evaluate(() => window.scrollY), 392, 'An absent mobile target should use the scroll fallback without timing out');
  } finally { await browser.close(); }
});
