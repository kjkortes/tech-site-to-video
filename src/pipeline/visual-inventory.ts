import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { Page } from 'playwright';
import { VisualAsset, Scene } from '../lib/types';
import { validatePublicUrl } from '../lib/network';
import { probe } from '../lib/process';
import { jobDir } from '../lib/store';

// Every image is independent, including images arranged in one README table/grid.
export async function discoverVisuals(page: Page) {
  const discover = () => {
    const root = document.querySelector('article.markdown-body') || document.querySelector('main,article,[role="main"]') || document.body;
    function selector(el: Element): string {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts: string[] = [];
      let current: Element | null = el;
      while (current && current !== document.body) {
        const tag = current.tagName.toLowerCase();
        const siblings: Element[] = current.parentElement ? [...current.parentElement.children].filter(s => s.tagName === current!.tagName) : [];
        parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`); current = current.parentElement;
      }
      return `body > ${parts.join(' > ')}`;
    }
    function context(el: Element) {
      const section = el.closest('section,figure,li,td') || el.parentElement!;
      // README headings often aren't wrapped in sections. Walk back to the preceding heading.
      let heading = section.querySelector('h1,h2,h3,h4');
      if (!heading) {
        for (const candidate of root.querySelectorAll('h1,h2,h3,h4')) {
          if (candidate.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) heading = candidate;
        }
      }
      const description = `${heading?.textContent || ''} ${el.getAttribute('alt') || el.getAttribute('title') || ''} ${section.querySelector('figcaption')?.textContent || ''} ${(section.textContent || '').replace(/\s+/g, ' ').slice(0, 420)}`.replace(/\s+/g, ' ').trim().slice(0, 650);
      return { description, features: [(heading?.textContent || '').trim().slice(0,100), (el.getAttribute('alt') || '').slice(0,120)].filter(Boolean) };
    }
    const items: { sectionId?: string; documentOrder?: number; scrollY?: number; type: 'image'|'gif'|'video'|'code'|'section'|'demo'; url: string; selector: string; description: string; features: string[]; text?: string; width: number; height: number; actions?: { type: 'click'; selector?: string; text: string; role: 'button'|'tab'|'link' }[] }[] = [];
    const seen = new Set<string>();
    for (const el of root.querySelectorAll('img,video,pre,section,iframe,a[href],button,[role="tab"]')) {
      const rect = el.getBoundingClientRect();
      const visible = getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
      if (!visible || rect.width < 20 || rect.height < 10) continue;
      const { description, features } = context(el); const target = selector(el);
      let owner = root.getAttribute('data-frameforge-section') || undefined;
      for(const heading of root.querySelectorAll('[data-frameforge-section]')) if(heading===el || heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) owner=heading.getAttribute('data-frameforge-section')||owner;
      const container=el.closest('[data-frameforge-section]');
      if(container && container!==root)owner=container.getAttribute('data-frameforge-section')||owner;
      const association={sectionId:owner,documentOrder:[...root.querySelectorAll('*')].indexOf(el),scrollY:Math.max(0,rect.top+scrollY-80)};
      if (el instanceof HTMLImageElement) {
        const src = el.currentSrc || el.src || el.getAttribute('data-src') || '';
        const width = el.naturalWidth || rect.width, height = el.naturalHeight || rect.height;
        if (!src || !/^https?:/.test(src) || width < 240 || height < 130 || /badge|shields\.io|avatar|logo|icon|tracking/i.test(`${src} ${el.alt}`) || seen.has(src)) continue;
        seen.add(src);
        const anchor = el.closest('a');
        const original = anchor?.href && /\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(anchor.href) ? anchor.href : src;
        items.push({ ...association, type: /\.gif(?:\?|$)/i.test(original) ? 'gif' : 'image', url: original, selector: target, features, description: description || 'Product screenshot', width, height });
      } else if (el instanceof HTMLVideoElement) {
        const src = el.currentSrc || el.src || el.querySelector('source')?.src;
        if (src && /^https?:/.test(src)) items.push({ ...association, type: 'video', url: src, selector: target, features, description: description || 'Product video', width: el.videoWidth || rect.width, height: el.videoHeight || rect.height });
      } else if (el.tagName === 'PRE') {
        const text = (el.textContent || '').trim().slice(0, 1400);
        if (text.length > 12) items.push({ ...association, type: 'code', url: location.href, selector: target, features, description, text, width: rect.width, height: rect.height });
      } else if (el.tagName === 'SECTION' && el.querySelector('h2,h3') && rect.height < 2000) {
        items.push({ ...association, type: 'section', url: location.href, selector: target, features, description, width: rect.width, height: rect.height });
      } else if (el.tagName === 'IFRAME') {
        const src = (el as HTMLIFrameElement).src;
        if (/^https?:/.test(src)) items.push({ ...association, type: 'demo', url: src, selector: target, features, description: `Embedded demo/video: ${description}`, width: rect.width, height: rect.height });
      } else {
        const text = (el.textContent || '').trim();
        if (/\b(demo|examples?|preview|gallery|play)\b/i.test(text) && text.length < 90 && !/download|install|sign|login|subscribe|buy/i.test(text)) {
          const href = el instanceof HTMLAnchorElement ? el.href : location.href;
          if (/^https?:/.test(href)) items.push({ ...association, type: 'demo', url: href, selector: target, features, description: `${text} ${description}`, width: rect.width, height: rect.height, actions: el instanceof HTMLAnchorElement ? undefined : [{ type: 'click', selector: target, text, role: el.getAttribute('role') === 'tab' ? 'tab' : 'button' }] });
        }
      }
    }
    // Keep media before text assets so a long README does not crowd out its screenshots.
    return items.sort((a,b) => Number(['image','gif','video'].includes(b.type)) - Number(['image','gif','video'].includes(a.type))).slice(0, 36);
  };
  // tsx's keepNames helper must travel with this browser-only closure.
  return page.evaluate<ReturnType<typeof discover>>(`(()=>{const __name=(fn)=>fn;return (${discover.toString()})();})()`);
}

export async function downloadVisual(url: string, destinationBase: string): Promise<{ path: string; type: 'image'|'gif'|'video' }> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    await validatePublicUrl(current);
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'Frameforge/1.0' } });
    if ([301,302,303,307,308].includes(response.status)) {
      const next = response.headers.get('location'); await response.body?.cancel();
      if (!next) throw new Error('Media redirect has no destination'); current = new URL(next, current).href; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Media returned HTTP ${response.status}`); }
    const contentType = response.headers.get('content-type')?.split(';')[0] || '';
    const extension = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm' } as Record<string,string>)[contentType];
    if (!extension || !response.body) { await response.body?.cancel(); throw new Error(`Unsupported source media: ${contentType}`); }
    const limit = 40 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw new Error('Source media exceeds 40 MB'); }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error('Source media exceeds 40 MB'); chunks.push(value); } }
    finally { await reader.cancel().catch(() => {}); }
    if (size < 100) throw new Error('Source media is empty');
    const file = destinationBase + extension; await writeFile(file, Buffer.concat(chunks));
    return { path: file, type: contentType.startsWith('video/') ? 'video' : contentType === 'image/gif' ? 'gif' : 'image' };
  }
  throw new Error('Too many media redirects');
}
export async function collectVisuals(id: string, page: Page, scene: Scene, offset: number, notes: string[]): Promise<VisualAsset[]> {
  const dir = jobDir(id); await mkdir(path.join(dir, 'assets'), { recursive: true });
  const discovered = await discoverVisuals(page); const assets: VisualAsset[] = [];
  for (const candidate of discovered) {
    const assetId = `asset-${offset + assets.length + 1}`;
    const asset: VisualAsset = { ...candidate, id: assetId, sceneId: scene.id, sourceId: scene.sourceId, pageUrl: candidate.type === 'demo' ? candidate.url : scene.url, features: candidate.features, quality: Math.min(1, candidate.width / 1600) * .7 + .2, confidence: candidate.description ? .8 : .5, canEnlarge: true, animated: ['video','gif','demo'].includes(candidate.type) };
    try {
      if (['image', 'gif', 'video'].includes(candidate.type)) {
        try { const downloaded = await downloadVisual(candidate.url, path.join(dir, 'assets', assetId)); asset.localPath = path.relative(dir, downloaded.path); asset.type = downloaded.type; const info = await probe(downloaded.path); const stream = info.streams.find(s=>s.codec_type==='video'); if (stream?.width && stream.height) { asset.width = stream.width; asset.height = stream.height; asset.quality = Math.min(1, stream.width / 1600) * .7 + .2; } }
        catch (error) {
          notes.push(`${assetId}: original media unavailable, using independent element capture: ${(error as Error).message}`);
          const localPath = `assets/${assetId}.png`;
          await page.locator(candidate.selector).screenshot({ path: path.join(dir, localPath), animations: 'disabled', timeout: 7000 });
          asset.localPath = localPath; asset.type = 'image'; asset.animated = false;
        }
      } else if (candidate.type !== 'demo') {
        const localPath = `assets/${assetId}.png`;
        await page.locator(candidate.selector).screenshot({ path: path.join(dir, localPath), animations: 'disabled', timeout: 7000 });
        asset.localPath = localPath;
      }
      assets.push(asset);
    } catch (error) { notes.push(`Skipped ${assetId}: ${(error as Error).message}`); }
  }
  return assets;
}
