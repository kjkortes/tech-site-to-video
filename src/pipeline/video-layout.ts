// Pages occupy the native portrait viewport. Media preserves its source aspect ratio.
import { verticalSafeArea } from './safe-area';
export const presentationMode = 'contextual-walkthrough' as const;
export const videoLayout = {
  width: 1080, height: 1920,
  browser: { ...verticalSafeArea.visual, chrome: 0, radius: 0 },
  viewport: { width: 1080, height: 1920 },
};
export const productPanel = { ...verticalSafeArea.visual };
export const pagePanel = { ...verticalSafeArea.visual };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

function sourceIdentity(title: string, url: string) {
  const source = new URL(url);
  const github = source.hostname === 'github.com';
  const repo = source.pathname.split('/').filter(Boolean).slice(0, 2).join('/');
  return { github, title: (github && repo ? repo : title).replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 100) };
}

const githubIcon = '<path d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-2.08c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.62 1.22 3.26.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.57 0-1.23.44-2.24 1.16-3.03-.12-.28-.5-1.43.11-2.98 0 0 .94-.3 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.55.23 2.7.11 2.98.72.79 1.16 1.8 1.16 3.03 0 4.33-2.63 5.28-5.14 5.56.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z"/>';
const globeIcon = '<g fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20M4 6h16M4 18h16"/></g>';

export const frameStyles = `
body{margin:0;font-family:Arial,sans-serif;color:#eef4ff;background:transparent}
#root{width:1080px;height:1920px;position:relative;overflow:hidden}
.frame{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.identity{position:absolute;left:32px;top:32px;max-width:760px;height:56px;display:flex;align-items:center;gap:10px;padding:0 14px;box-sizing:border-box;background:#0c1b35bd;border-radius:8px}
.source-icon{width:28px;height:28px;flex:none;color:#f2f6ff;fill:currentColor}
.title{margin:0;font-size:28px;line-height:1.15;font-weight:700;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
`;
export const fitTitlesScript = `document.querySelectorAll('.identity').forEach(row=>{const title=row.querySelector('.title');let size=28;const available=row.clientWidth-66;while(size>20&&title.scrollWidth>available){title.style.fontSize=(--size)+'px';}});`;

export function frameMarkup(title: string, url: string, _prefix: string, sourceUrl = url, framing: 'context' | 'product' | 'detail' = 'context', _sectionHeading = '', showIdentity = true) {
  const identity = sourceIdentity(title, sourceUrl);
  return `<div class="frame frame-${framing}">${showIdentity ? `<div class="identity"><svg class="source-icon" viewBox="0 0 24 24" aria-hidden="true">${identity.github ? githubIcon : globeIcon}</svg><h1 class="title">${escapeHtml(identity.title)}</h1></div>` : ''}</div>`;
}

export function panelFor(framing?: 'context' | 'product' | 'detail') { return !framing || framing === 'context' ? pagePanel : productPanel; }
