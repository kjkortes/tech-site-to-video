import type { Inventory, VisualAsset } from '../lib/types';
const words = (text: string) => new Set(text.toLowerCase().replace(/\blayered\b/g,'layers').replace(/\b(?:edit|edits|editor)\b/g,'editing').split(/\W+/).filter(w => w.length > 3));
export function relevance(text: string, description: string) {
  const tokens = words(text); return [...words(description)].filter(w => tokens.has(w)).length;
}
export function assetsFor(inventory: Inventory): VisualAsset[] {
  return [...(inventory.assets || []).map(a=>({...a,sectionId:a.sectionId||inventory.scenes.find(s=>s.id===a.sceneId)?.sectionId||a.sceneId})), ...inventory.scenes.map(s => ({ id: s.id, sceneId: s.id, sectionId: s.sectionId || s.id, sourceId: s.sourceId, type: 'section' as const, url: s.url, pageUrl: s.url, localPath: s.screenshot, description: `${s.title} ${s.description}`, features: [s.title], width: inventory.captureViewport?.width || 1280, height: inventory.captureViewport?.height || 2120, quality: .45, confidence: .7, actions: s.actions, canEnlarge: true, animated: s.actions.some(a => a.type === 'click') }))];
}
