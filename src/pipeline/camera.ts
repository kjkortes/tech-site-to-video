import { Shot } from '../lib/types';
import { run } from '../lib/process';
import { validRegion } from './direct';
import { panelFor } from './video-layout';

export function cameraFilter(shot: Shot) {
  const panel = panelFor(shot.framing); const frames = Math.max(1, Math.round(shot.duration * 30) - 1);
  const progress = `min(1,on/${frames})`;
  const filters: string[] = [];
  // Source-space annotations move with the camera and cannot drift away from the UI.
  if (shot.highlight && validRegion(shot.highlight)) {
    const r = shot.highlight;
    filters.push(`drawbox=x=iw*${r.x}:y=ih*${r.y}:w=iw*${r.width}:h=ih*${r.height}:color=0x60a5fa@0.95:t=6`);
  }
  if (shot.focus && validRegion(shot.focus)) {
    const r = shot.focus;
    filters.push(`crop=w=trunc(iw*${r.width}/2)*2:h=trunc(ih*${r.height}/2)*2:x=iw*${r.x}:y=ih*${r.y}`);
  }
  filters.push(`scale=${panel.width * 2}:${panel.height * 2}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${panel.width * 2}:${panel.height * 2}:(ow-iw)/2:(oh-ih)/2:color=0x0c1b35`);
  const motion = shot.motion || 'hold';
  const zoom = motion === 'slow-push' ? `1+0.12*${progress}` : motion === 'slow-pull' ? `1.12-0.12*${progress}` : motion.startsWith('pan') ? '1.12' : '1';
  let x = 'iw/2-iw/zoom/2', y = 'ih/2-ih/zoom/2';
  if (motion === 'pan-right') x = `(iw-iw/zoom)*${progress}`;
  if (motion === 'pan-left') x = `(iw-iw/zoom)*(1-${progress})`;
  if (motion === 'pan-down') y = `(ih-ih/zoom)*${progress}`;
  if (motion === 'pan-up') y = `(ih-ih/zoom)*(1-${progress})`;
  filters.push('fps=30');
  filters.push(`zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${panel.width}x${panel.height}:fps=30,setsar=1,format=yuv420p`);
  return filters.join(',');
}
export async function renderCameraClip(source: string, destination: string, shot: Shot, animated = false, sourceStart = 0) {
  await run('ffmpeg', ['-y', ...(animated ? ['-stream_loop','-1'] : ['-loop','1','-framerate','30']), ...(sourceStart > 0 ? ['-ss',String(sourceStart)] : []), '-i', source, '-vf', cameraFilter(shot), '-t', String(shot.duration + .15), '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', destination]);
}
