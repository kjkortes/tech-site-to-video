import { Shot, VisualAsset } from '../lib/types';
import { escapeHtml } from './video-layout';
export function generatedScene(shot: Shot, asset: VisualAsset, visibleNodes = Infinity) {
  if (shot.type === 'diagram') {
    if (!shot.diagram) throw new Error('Diagram has no evidenced nodes');
    const { nodes, edges } = shot.diagram;
    const positions = nodes.map((_,i) => ({ x: 486, y: 170 + i * 190 }));
    const lines = edges.map(e => {
      const from = nodes.findIndex(n=>n.id===e.from), to = nodes.findIndex(n=>n.id===e.to);
      if (from < 0 || to < 0) throw new Error('Unknown diagram node');
      if (from >= visibleNodes || to >= visibleNodes) return '';
      const a = positions[from], b = positions[to];
      return `<path d="M${a.x} ${a.y + 45}L${b.x} ${b.y - 45}" stroke="#60a5fa" stroke-width="7" fill="none" marker-end="url(#arrow)"/>`;
    }).join('');
    return `<svg width="972" height="1130" viewBox="0 0 972 1130"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0 0L8 3L0 6Z" fill="#60a5fa"/></marker></defs>${lines}${nodes.slice(0,visibleNodes).map((n,i)=>`<rect x="186" y="${positions[i].y - 50}" width="600" height="100" rx="24" fill="#18365d" stroke="#60a5fa" stroke-width="3"/><text x="486" y="${positions[i].y + 15}" text-anchor="middle" fill="#eef4ff" font-size="40" font-family="Arial">${escapeHtml(n.label)}</text>`).join('')}</svg>`;
  }
  if (shot.type === 'code_focus') {
    const sourceLines = (asset.text || '').split('\n');
    const lines = sourceLines.slice((shot.codeRange?.start || 1)-1, shot.codeRange?.end || 7);
    const excerpt = lines.join('\n');
    const size = 32;
    return `<section style="padding:70px 48px"><p style="font:30px Arial;color:#9fc6ff">${escapeHtml(asset.features[0] && asset.features[0].length <= 50 ? asset.features[0] : 'Source example')}</p><pre style="font:${size}px/1.7 monospace;color:#eef4ff;white-space:pre-wrap;overflow-wrap:anywhere;max-height:840px;overflow:hidden;background:#101e36;padding:32px;border-left:5px solid #60a5fa;border-radius:20px">${escapeHtml(excerpt)}</pre>${lines.length < sourceLines.length ? '<p style="font:22px Arial;color:#9fc6ff">Excerpt · full example in the source</p>' : ''}</section>`;
  }
  throw new Error(`Unsupported generated shot ${shot.type}`);
}
