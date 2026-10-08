import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchBrowser, newContext, navigate, perform, matchesCapture, viewport, captureRevision } from '../src/pipeline/browser';
import { pagePanel } from '../src/pipeline/video-layout';
import { probe, run } from '../src/lib/process';

test('vertical video captures desktop breakpoints and fills the browser panel', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'frameforge-desktop-'));
  const browser = await launchBrowser();
  try {
    const context = await newContext(browser, directory);
    await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#1556aa}main{width:100%;height:100%;background:#1556aa}@media(max-width:1024px){main{width:70%}}</style><main>Desktop demo</main>` }));
    const page = await context.newPage(); await page.goto('https://example.com/');
    const layout = await page.evaluate(() => ({
      mobile: matchMedia('(max-width:1024px)').matches,
      touch: navigator.maxTouchPoints > 0,
      mobileAgent: /Android|Mobile/.test(navigator.userAgent),
      width: innerWidth,
      contentWidth: document.querySelector('main')!.getBoundingClientRect().width,
    }));
    assert.equal(layout.mobile, false, 'Vertical demos must use the desktop page layout');
    assert.equal(layout.touch, false, 'Capture should use desktop input');
    assert.equal(layout.mobileAgent, false, 'Sites must receive a desktop user agent');
    assert.equal(layout.contentWidth, layout.width, 'Responsive content should fill the viewport');
    await page.waitForTimeout(1200);
    const video = page.video()!; await context.close();
    const file = await video.path(); const info = await probe(file);
    const stream = info.streams.find(s => s.codec_type === 'video')!;
    assert.equal(stream.width, viewport.width); assert.equal(stream.height, viewport.height);
    assert.ok(Math.abs(stream.width! / stream.height! - pagePanel.width / pagePanel.height) < 0.001, 'Capture must fit the browser panel without side padding');
    const edge = await run('ffmpeg', ['-v', 'error', '-ss', '0.8', '-i', file, '-vf', `crop=20:${stream.height}:${stream.width! - 20}:0,signalstats,metadata=print:file=-`, '-frames:v', '1', '-f', 'null', '-']);
    const luma = Number(/lavfi.signalstats.YAVG=([\d.]+)/.exec(edge)?.[1]);
    assert.ok(luma > 40 && luma < 110, `The right edge should contain the page, not white/black padding (luma ${luma})`);
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});

test('replay skips hidden responsive duplicates', async () => {
  const browser = await launchBrowser();
  try {
    const context = await newContext(browser); const page = await context.newPage();
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div style="display:none">File tree</div><div style="height:3500px"></div><p>File tree</p>');
    await perform(page, { type: 'scroll', text: 'File tree', y: 392 });
    assert.ok(await page.evaluate(() => window.scrollY > 1000), 'Replay must find the visible target after a hidden duplicate');
    await page.setContent('<div style="display:none">Desktop sidebar</div><div style="height:3500px"></div>');
    await perform(page, { type: 'scroll', text: 'Desktop sidebar', y: 392 });
    assert.equal(await page.evaluate(() => window.scrollY), 392, 'An absent target should use the scroll fallback without timing out');
  } finally { await browser.close(); }
});

test('capture migration replaces mobile and outdated desktop clips', () => {
  assert.equal(matchesCapture({ captureMode: 'mobile', captureViewport: { width: 390, height: 484 } }), false);
  assert.equal(matchesCapture({ captureMode: 'desktop' }), false);
  assert.equal(matchesCapture({ captureMode: 'desktop', captureViewport: { width: 1000, height: 1240 } }), false);
  assert.equal(matchesCapture({ captureMode: 'desktop', captureViewport: { ...viewport } }), false, 'Old captures still include GitHub chrome');
  assert.equal(matchesCapture({captureMode:'desktop',captureViewport:{...viewport},captureRevision:2}),false,'Old layout intrudes into social platform UI');
  assert.equal(matchesCapture({ captureMode: 'desktop', captureViewport: { ...viewport }, captureRevision }), true);
});

test('GitHub captures preserve native README layout and source context', async () => {
  const browser = await launchBrowser();
  try {
    const context = await newContext(browser);
    const fixture = `<!doctype html><title>PhotoCraft</title><style>
      body{margin:0} .layout{display:grid;grid-template-columns:952px 328px}
      [data-component="SplitPageLayout.Content"]{min-width:0}
      [data-width="large"]{max-width:952px} article{margin:32px;max-width:1012px}
      .files{height:2800px} .hero{height:600px;background:steelblue}
    </style><div class="layout">
      <div data-component="SplitPageLayout.Content"><div data-width="large">
        <div class="files">Repository files</div><article class="markdown-body">
          <p>ARTCRAFT</p><h1>PhotoCraft</h1><p>Image editing in Rust.</p>
          <div class="hero">The Great Wave screenshot</div><div style="height:3000px"></div><h2 id="features">Features</h2><div style="height:2500px"></div>
        </article></div></div>
      <div data-position="end"><div data-component="SplitPageLayout.Pane">About · Languages</div></div>
    </div>`;
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    const page = await context.newPage();
    await navigate(page, 'https://github.com/storytold/photocraft');
    assert.equal(await page.locator('[data-component="SplitPageLayout.Pane"]').isVisible(), true);
    const article = await page.locator('article').boundingBox();
    assert.ok(article && article.width === 888, `README retains its native width: ${article?.width}`);
    assert.ok(article && article.y >= 0 && article.y <= 100, `README opening should be at the top: ${article?.y}`);
    const hero = await page.locator('.hero').boundingBox();
    assert.ok(hero && hero.y > 0 && hero.y + hero.height < viewport.height, 'Opening screenshot must be in frame');
    await perform(page, { type: 'scroll', text: 'PhotoCraft' });
    assert.ok((await page.locator('article').boundingBox())!.y >= 0, 'Scrolling to the product title must retain its opening logo');
    await navigate(page, 'https://github.com/storytold/photocraft#features');
    assert.ok(Math.abs((await page.locator('#features').boundingBox())!.y) < 150, 'Explicit README section links must keep their target');
    await navigate(page, 'https://example.com/');
    assert.equal(await page.locator('[data-component="SplitPageLayout.Pane"]').isVisible(), true, 'Other websites keep their original layout');
    assert.equal(await page.evaluate(() => scrollY), 0);
  } finally { await browser.close(); }
});

test('clean capture detects consent overlays while ignoring hidden duplicates', async () => {
  const { consentObscuresPage }=await import('../src/pipeline/browser');
  const browser=await launchBrowser();
  try {
    const page=await browser.newPage({viewport:{width:1280,height:2120}});
    await page.setContent('<div role="dialog" style="display:none">Cookies</div><div role="dialog" style="position:fixed;inset:0">Cookie consent controls</div>');
    assert.equal(await consentObscuresPage(page),true);
    await page.locator('[role="dialog"]').last().evaluate(el=>(el as HTMLElement).style.display='none');
    assert.equal(await consentObscuresPage(page),false);
  } finally { await browser.close(); }
});
