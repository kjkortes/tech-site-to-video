import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { validatePublicUrl } from '../lib/network';
import { BrowserAction } from '../lib/types';
import { config } from '../lib/config';
import { videoLayout } from './video-layout';

export const captureMode = 'desktop' as const;
export const captureRevision = 2;
export const viewport = videoLayout.viewport;
export function matchesCapture(value: { captureMode?: 'mobile' | 'desktop'; captureViewport?: { width: number; height: number }; captureRevision?: number }) {
  return value.captureRevision === captureRevision && value.captureMode === captureMode && value.captureViewport?.width === viewport.width && value.captureViewport?.height === viewport.height;
}
// Playwright records CSS pixels and does not upscale to deviceScaleFactor.
// A larger recording canvas would leave empty space beside and below the page.
export const recordingSize = { ...viewport };
export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true, handleSIGINT: false, handleSIGTERM: false, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--disable-dev-shm-usage', '--disable-background-networking'] });
}
export async function guardContext(context: BrowserContext) {
  const checked = new Map<string, number>();
  await context.route('**/*', async route => {
    const request = route.request();
    const url = request.url();
    if (!/^https?:/.test(url)) return route.abort();
    // Exploration never submits forms or makes writes to a remote application.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.abort();
    try {
      const origin = new URL(url).origin;
      if (Date.now() - (checked.get(origin) || 0) > 10000) {
        await validatePublicUrl(url); checked.set(origin, Date.now());
      }
      await route.continue();
    } catch { await route.abort(); }
  });
  context.on('page', page => { page.on('dialog', dialog => { void dialog.dismiss(); }); });
}
export async function newContext(browser: Browser, recordingDir?: string) {
  const context = await browser.newContext({
    viewport, isMobile: false, hasTouch: false, deviceScaleFactor: 2, reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: false,
    ...(recordingDir ? { recordVideo: { dir: recordingDir, size: recordingSize } } : {}) });
  await guardContext(context); return context;
}
export async function navigate(page: Page, url: string) {
  await validatePublicUrl(url);
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
  if (response && response.status() >= 400) throw new Error(`Website returned HTTP ${response.status()}`);
  await page.waitForTimeout(1200);
  const title = await page.title();
  if (/\b(404|403|access denied|just a moment|page not found|verify you are human)\b/i.test(title)) throw new Error(`Website cannot be demonstrated: ${title}`);
  await prepareGitHubCapture(page);
}
async function prepareGitHubCapture(page: Page) {
  if (new URL(page.url()).hostname !== 'github.com') return;
  const readme = page.locator('article.markdown-body').filter({ visible: true }).first();
  if (!await readme.count()) return;
  await readme.evaluate(article => {
    const content = article.closest('[data-component="SplitPageLayout.Content"]');
    content?.setAttribute('data-frameforge-github-content', '');
    content?.parentElement?.setAttribute('data-frameforge-github-layout', '');
  });
  if (!await page.locator('#frameforge-github-capture').count()) {
    await page.addStyleTag({ content: `
      [data-frameforge-github-layout] { grid-template-columns: minmax(0, 1fr) !important; }
      [data-frameforge-github-layout] > [data-position="end"] { display: none !important; }
      [data-frameforge-github-content] { width: 100% !important; max-width: none !important; grid-column: 1 / -1 !important; }
      [data-frameforge-github-content] [data-width], article.markdown-body { max-width: none !important; }
    ` }).then(style => style.evaluate(el => { (el as HTMLStyleElement).id = 'frameforge-github-capture'; }));
  }
  await readme.evaluate(article => {
    let anchor: HTMLElement | null = null;
    try { anchor = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { /* Invalid hashes use the overview. */ }
    const target = anchor && article.contains(anchor) ? anchor : article;
    window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - 80), behavior: 'instant' });
  });
}
export async function dismissConsent(page: Page) {
  for (const name of ['Reject all', 'Decline optional cookies', 'Only necessary cookies', 'Accept necessary']) {
    const button = page.getByRole('button', { name, exact: true }).first();
    if (await button.isVisible().catch(() => false)) { await button.click({ timeout: 1500 }).catch(() => {}); break; }
  }
}
const unsafeInteraction = /delete|remove|purchase|checkout|pay\b|subscribe|sign.?up|log.?in|sign.?in|authorize|publish|deploy|send|submit|install|download|start free|create account|buy|connect|accept all/i;
export async function perform(page: Page, action: BrowserAction) {
  if (action.type === 'scroll') {
    if (action.text) {
      const target = page.getByRole('heading', { name: action.text, exact: true }).filter({ visible: true }).first();
      if (await target.count()) {
        if (new URL(page.url()).hostname === 'github.com') {
          await target.evaluate(el => {
            const article = el.closest('article.markdown-body');
            // Keep logos and introduction text above the first README heading in frame.
            const top = article?.querySelector('h1,h2,h3') === el ? article : el;
            window.scrollTo({ top: Math.max(0, top.getBoundingClientRect().top + window.scrollY - 80), behavior: 'instant' });
          });
        } else await target.scrollIntoViewIfNeeded({ timeout: 5000 });
        return;
      }
      const text = page.getByText(action.text, { exact: true }).filter({ visible: true }).first();
      if (await text.count()) { await text.scrollIntoViewIfNeeded({ timeout: 5000 }); return; }
    }
    await page.evaluate(y => window.scrollTo(0, y), action.y || 0); return;
  }
  if (unsafeInteraction.test(action.text) || !/demo|example|preview|gallery|feature|play|tab|overview|documentation/i.test(action.text)) throw new Error('Interaction is outside public demo exploration');
  const locators = [
    ...(action.selector ? [page.locator(action.selector).first()] : []),
    page.getByRole(action.role, { name: action.text, exact: true }).first(),
    page.getByText(action.text, { exact: true }).first(),
  ];
  for (const locator of locators) {
    try {
      if (!await locator.isVisible()) continue;
      const element = await locator.evaluate(el => ({ tag: el.tagName, type: el.getAttribute('type'), href: el.getAttribute('href'), text: el.textContent || '' }));
      if (unsafeInteraction.test(element.text)) continue;
      if (element.tag === 'INPUT' || element.type === 'submit') continue;
      if (element.href) await validatePublicUrl(new URL(element.href, page.url()).href);
      // Prevent unnamed form submission buttons.
      if (await locator.evaluate(el => el.tagName === 'BUTTON' && el.closest('form') !== null && el.getAttribute('type') !== 'button')) continue;
      await locator.click({ timeout: 5000 }); await page.waitForTimeout(600);
      await validatePublicUrl(page.url()); return;
    } catch { /* Retry a semantic locator before falling back to a screenshot. */ }
  }
  throw new Error(`Could not replay interaction: ${action.text}`);
}
export async function inspectPage(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('article.markdown-body, article, main, [role="main"]') || document.body;
    const clone = main.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, style, nav, footer, header, svg').forEach(e => e.remove());
    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
      text: (main as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 22000),
      excerpts: [...clone.querySelectorAll('p,li')].map(el => (el.textContent || '').replace(/\s+/g, ' ').trim()).filter(text => text.length > 45 && text.length < 800).slice(0, 60),
      headings: [...main.querySelectorAll('h1,h2,h3')].map(h => ({ text: (h.textContent || '').trim().slice(0, 150), y: Math.max(0, h.getBoundingClientRect().top + window.scrollY - 180) })).filter(h => h.text.length > 2).slice(0, 18),
      links: [...document.querySelectorAll('a[href]')].map(a => ({ text: (a.textContent || '').trim().slice(0, 100), href: (a as HTMLAnchorElement).href })).filter(a => a.text && /demo|doc|feature|example|gallery|readme/i.test(a.text)).slice(0, 30),
      controls: [...document.querySelectorAll('button,[role="tab"]')].map(el => ({ text: (el.textContent || '').trim().slice(0, 100), role: el.getAttribute('role') || 'button' })).filter(a => /demo|example|preview|gallery|play|overview/i.test(a.text)).slice(0, 12),
    };
  });
}
export function relevantLinks(url: string, links: { text: string; href: string }[]) {
  const initial = new URL(url);
  return links.filter(link => {
    try {
      const target = new URL(link.href);
      if (target.origin !== initial.origin || target.href.split('#')[0] === initial.href.split('#')[0]) return false;
      if (initial.hostname === 'github.com') {
        const repo = initial.pathname.split('/').slice(0, 3).join('/');
        return target.pathname.startsWith(`${repo}/`) && !/\/issues|\/pulls|\/actions|\/releases|\/login/.test(target.pathname);
      }
      return !unsafeInteraction.test(link.text);
    } catch { return false; }
  }).slice(0, config.explorePages - 1);
}

export async function consentObscuresPage(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('[role="dialog"],#onetrust-banner-sdk,.cookie-banner,[aria-label*="cookie" i]')].some(el => {
    const r = el.getBoundingClientRect(); const style = getComputedStyle(el);
    return /cookie|consent/i.test(el.textContent || el.getAttribute('aria-label') || '') && style.display !== 'none' && style.visibility !== 'hidden' && r.width * r.height > innerWidth * innerHeight * .08;
  }));
}
