import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from '../src/pipeline/browser';
import { discoverVisuals } from '../src/pipeline/visual-inventory';

test('README screenshot grid yields six independent images and a code asset', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`<article class="markdown-body"><h2>Layers and masks</h2><table><tr>${Array.from({length:6},(_,i)=>`<td><img width="600" height="400" src="https://example.test/screen-${i}.png" alt="Product screen ${i}"></td>`).join('')}</tr></table><img width="100" height="30" src="https://shields.io/badge/test" alt="badge"><pre>npm install sample\nsample --output image.png</pre></article>`);
    const assets = await discoverVisuals(page);
    assert.equal(assets.filter(a=>a.type==='image').length,6);
    assert.equal(new Set(assets.filter(a=>a.type==='image').map(a=>a.url)).size,6);
    assert.ok(assets.some(a=>a.type==='code' && a.text?.includes('npm install')));
    assert.ok(assets.filter(a=>a.type==='image').every(a=>a.description.includes('Layers and masks')));
    for (const asset of assets) assert.equal(await page.locator(asset.selector).count(),1);
  } finally { await browser.close(); }
});
