// Capture desktop breakpoints inside a portrait canvas. Keep both renderers and
// the browser viewport in the same aspect ratio so the page is never cropped.
export const videoLayout = {
  width: 1080, height: 1920,
  browser: { x: 54, y: 188, width: 972, height: 1684, chrome: 74, radius: 28 },
  viewport: { width: 1280, height: 2120 },
};
export const pagePanel = {
  x: videoLayout.browser.x, y: videoLayout.browser.y + videoLayout.browser.chrome,
  width: videoLayout.browser.width, height: videoLayout.browser.height - videoLayout.browser.chrome,
};
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
.frame{position:absolute;inset:0;pointer-events:none}.frame-bg{position:absolute;inset:0;width:1080px;height:1920px}
.brand{position:absolute;left:78px;top:26px;margin:0;font-size:30px;letter-spacing:1.5px;color:#9fc6ff}
.identity{position:absolute;left:72px;top:72px;width:930px;height:76px;display:flex;align-items:center;gap:24px}
.source-icon{width:68px;height:68px;flex:none;color:#f2f6ff;fill:currentColor}
.title{margin:0;font-size:60px;line-height:1.15;font-weight:700;white-space:nowrap;min-width:0;overflow:hidden}
.browser-outline{position:absolute;left:54px;top:188px;width:972px;height:1684px;box-sizing:border-box;border:2px solid #4169a5;border-radius:28px;box-shadow:0 0 24px #6395ed38}
.chrome{position:absolute;left:56px;top:190px;width:968px;height:72px;box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:0 28px;background:linear-gradient(#101e36,#071126);border-radius:26px 26px 0 0}
.traffic{display:flex;gap:12px;margin-right:36px}.traffic i{width:18px;height:18px;border-radius:50%;background:#ff6059}.traffic i:nth-child(2){background:#ffc52f}.traffic i:nth-child(3){background:#29cc59}
.address{display:flex;align-items:center;gap:12px;flex:1;min-width:0;height:46px;padding:0 18px;background:#1b2943;border-radius:12px;color:#d6e0f2;font-size:20px}
.address span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chrome svg{width:22px;height:22px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7;color:#aebdd4}.chrome-tools{display:flex;gap:28px;margin-left:12px}
`;

// Run synchronously in each standalone HTML document; use actual font metrics
// for long product/repository names instead of dropping a second line.
export const fitTitlesScript = `document.querySelectorAll('.identity').forEach(row=>{const title=row.querySelector('.title');let size=60;const available=row.clientWidth-92;while(size>20&&title.scrollWidth>available){title.style.fontSize=(--size)+'px';}});`;

export function frameMarkup(title: string, url: string, prefix: string, sourceUrl = url) {
  const identity = sourceIdentity(title, sourceUrl);
  const source = new URL(url);
  const address = escapeHtml(`${source.host}${source.pathname === '/' ? '' : source.pathname}`);
  return `<div class="frame">
<svg class="frame-bg" data-layout-allow-overflow viewBox="0 0 1080 1920" aria-hidden="true"><defs><linearGradient id="${prefix}-navy" x2="1" y2="1"><stop stop-color="#1c355d"/><stop offset=".52" stop-color="#0c1b35"/><stop offset="1" stop-color="#071226"/></linearGradient><mask id="${prefix}-window"><rect width="1080" height="1920" fill="white"/><rect x="54" y="188" width="972" height="1684" rx="28" fill="black"/></mask></defs><g mask="url(#${prefix}-window)"><rect width="1080" height="1920" fill="url(#${prefix}-navy)"/><path d="M938 48Q963 21 992 41L1150 141L1035 440L853 230Z" fill="#153765" opacity=".65"/><rect x="672" y="-22" width="355" height="32" rx="10" fill="none" stroke="#4169a5" stroke-width="2"/></g></svg>
<p class="brand">Software, in a minute.</p><div class="identity"><svg class="source-icon" viewBox="0 0 24 24" aria-hidden="true">${identity.github ? githubIcon : globeIcon}</svg><h1 class="title">${escapeHtml(identity.title)}</h1></div>
<div class="browser-outline"></div><div class="chrome"><div class="traffic"><i></i><i></i><i></i></div><div class="address"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><span>${address}</span></div><div class="chrome-tools"><svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><svg viewBox="0 0 24 24"><path d="M4 12h2m5 0h2m5 0h2"/></svg></div></div></div>`;
}
