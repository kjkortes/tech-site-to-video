import { z } from 'zod';
import { launchBrowser, newContext, navigate, inspectPage, relevantLinks, dismissConsent } from './browser';
import { config } from '../lib/config';
import { modelJson } from '../lib/llm';
import { Claim, Research, Source } from '../lib/types';

const claimSchema = z.object({ title: z.string().max(100), description: z.string().max(500), claims: z.array(z.object({ text: z.string().max(400), sourceId: z.string(), quote: z.string().max(600) })).min(1).max(10) });
export function backedClaims(claims: Omit<Claim, 'id'>[], sources: Source[]): Claim[] {
  return claims.filter(claim => {
    const source = sources.find(s => s.id === claim.sourceId);
    return source && claim.quote.trim().length >= 12 && source.text.includes(claim.quote);
  }).map((claim, i) => ({ ...claim, id: `claim-${i + 1}` }));
}
export function extractClaims(sources: Source[]): Claim[] {
  const quotes = sources.flatMap(source => source.text.split(/(?<=[.!?])\s+/).filter(s => s.length > 45 && s.length < 280 && !/cookie|sign in|all rights|privacy policy|skip to|navigation menu/i.test(s)).slice(0, 5).map(text => ({ text, quote: text, sourceId: source.id })));
  return backedClaims(quotes.slice(0, 12), sources);
}
export async function research(url: string): Promise<Research> {
  const browser = await launchBrowser();
  const sources: Source[] = [];
  let description = '';
  try {
    const context = await newContext(browser); const page = await context.newPage();
    await navigate(page, url); await dismissConsent(page);
    const first = await inspectPage(page); description = first.description;
    if (first.text.length < 60) throw new Error('The website has too little accessible content or requires authentication. Try its public documentation URL.');
    sources.push({ id: 'source-1', url: page.url(), title: first.title, text: first.excerpts.join(' ').length > 150 ? first.excerpts.join(' ') : first.text });
    for (const link of relevantLinks(page.url(), first.links)) {
      try {
        await navigate(page, link.href); const info = await inspectPage(page);
        if (info.text.length > 60) sources.push({ id: `source-${sources.length + 1}`, url: page.url(), title: info.title, text: info.excerpts.join(' ').length > 150 ? info.excerpts.join(' ') : info.text });
      } catch { /* Optional public documentation cannot abort primary research. */ }
    }
  } finally { await browser.close(); }
  const pieces = sources[0].title.split(/\s[|–—]\s/);
  const address = new URL(url);
  const compactBrand = pieces.length > 1 && pieces.at(-1)!.length <= 32 ? pieces.at(-1)! : pieces[0];
  const title = (address.hostname === 'github.com' ? address.pathname.split('/').filter(Boolean).slice(0, 2).join('/') : compactBrand).replace(/^GitHub\s*-\s*/i, '').slice(0, 90) || address.hostname;
  if (config.llmKey) {
    const result = await modelJson('Research this product. Return {title,description,claims:[{text,sourceId,quote}]}. Every quote must be an exact substring of its source. Identify core capabilities, audience, pricing and license only where documented. Ignore navigation and marketing superlatives.', sources, claimSchema);
    const claims = backedClaims(result.claims, sources);
    if (!claims.length) throw new Error('The research model returned no source-backed claims.');
    return { ...result, claims, sources, mode: 'model' };
  }
  const claims = extractClaims(sources);
  if (!claims.length) throw new Error('No usable source excerpts found. Configure a research model or use a documentation URL.');
  return { title, description, sources, claims, mode: 'extractive' };
}
