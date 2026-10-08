export interface Rect { x: number; y: number; width: number; height: number; }
// Cross-platform 1080×1920 preset. Background/source pixels may fill the entire
// viewport; only captions and the feature being explained must avoid UI controls.
export const verticalSafeArea = {
  width: 1080, height: 1920,
  captions: { x: 96, y: 1344, width: 756, height: 192 },
  rightControls: { x: 886, y: 0, width: 194, height: 1920 },
  bottomControls: { x: 0, y: 1574, width: 1080, height: 346 },
  branding: { x: 32, y: 32, width: 760, height: 56 },
  focal: { x: 24, y: 108, width: 838, height: 1208 },
  visual: { x: 0, y: 0, width: 1080, height: 1920 },
} satisfies Record<string, number | Rect>;
export function intersects(a: Rect, b: Rect) { return a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y; }
export function contains(a: Rect, b: Rect) { return b.x>=a.x && b.y>=a.y && b.x+b.width<=a.x+a.width+.1 && b.y+b.height<=a.y+a.height+.1; }
export function safeVisual(rect: Rect) { return contains(verticalSafeArea.visual,rect) && rect.width>=1080*.95 && rect.width*rect.height>=1080*1920*.9; }
