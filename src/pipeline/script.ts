import { z } from 'zod';
import { config } from '../lib/config';
import { modelJson } from '../lib/llm';
import { Research, Inventory, Script } from '../lib/types';

export function validateScript(script: Script, research: Research, inventory: Inventory) {
  for (const segment of script.segments) {
    const scene = inventory.scenes.find(s => s.id === segment.sceneId);
    if (!scene) throw new Error(`Narration has no discovered visual: ${segment.id}`);
    if (segment.claimIds.some(id => !research.claims.some(c => c.id === id))) throw new Error('Narration references an unknown claim');
    if (segment.claimIds.some(id => research.claims.find(c => c.id === id)?.sourceId !== scene.sourceId)) throw new Error('Narration is paired with footage from a different source');
    if (!segment.text.trim()) throw new Error('Empty narration segment');
    if (script.mode === 'model' && !segment.claimIds.length) throw new Error('Model narration must cite at least one researched claim per segment');
  }
}
export async function writeScript(research: Research, inventory: Inventory): Promise<Script> {
  if (config.llmKey) {
    const result = await modelJson('Write an approximately 60-second discovery video, 125–145 spoken words, 5–7 segments. Return {segments:[{text,sceneId,claimIds}]}. Every segment needs at least one claim citation, and must match a discovered visual with the same sourceId as its claims. Explain only what can actually be shown. No exaggerated opening, unsupported free/pricing claims or publishing claims.', { research, inventory }, z.object({ segments: z.array(z.object({ text: z.string().min(1).max(800), sceneId: z.string(), claimIds: z.array(z.string()).min(1) })).min(3).max(8) }));
    const script: Script = { title: research.title, mode: 'model', segments: result.segments.map((s, i) => ({ ...s, id: `segment-${i + 1}` })) };
    validateScript(script, research, inventory); return script;
  }
  // Offline mode only narrates exact source excerpts, plus an explicitly attributed introduction.
  const usable = research.claims.filter(c => inventory.scenes.some(s => s.sourceId === c.sourceId));
  const segments: Script['segments'] = [];
  let count = 0;
  for (const claim of usable) {
    const sourceScenes = inventory.scenes.filter(s => s.sourceId === claim.sourceId);
    const keywords = new Set(claim.quote.toLowerCase().split(/\W+/).filter(w => w.length > 4));
    const score = (text: string) => text.toLowerCase().split(/\W+/).filter(w => keywords.has(w)).length;
    const scene = [...sourceScenes].sort((a, b) => score(b.description) - score(a.description))[0];
    const text = segments.length === 0 ? `Here's a look at ${research.title}. The project's website describes it this way: ${claim.quote}` : claim.quote;
    const words = text.split(/\s+/).length;
    if (count + words > 150 && segments.length >= 3) break;
    segments.push({ id: `segment-${segments.length + 1}`, text, sceneId: scene.id, claimIds: [claim.id] });
    count += words;
    if (count >= 130 || segments.length >= 7) break;
  }
  if (!segments.length) throw new Error('No claims could be matched to discovered visuals');
  const last = inventory.scenes[0];
  segments.push({ id: `segment-${segments.length + 1}`, text: 'Visit the project to explore the documentation and decide whether it fits your workflow.', sceneId: last.id, claimIds: [] });
  const script: Script = { title: research.title, mode: 'extractive', segments };
  validateScript(script, research, inventory); return script;
}
