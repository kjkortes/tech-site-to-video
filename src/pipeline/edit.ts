import path from 'node:path';
import { mkdir, writeFile, copyFile, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { config } from '../lib/config';
import { jobDir } from '../lib/store';
import { Shot, ShotResult, Transcript } from '../lib/types';
import { run } from '../lib/process';
import { captionChunks, toAss, toSrt } from './captions';

const require = createRequire(import.meta.url);
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const safeTitle = (s: string) => s.replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 65);
function titleLines(title: string) {
  const words = safeTitle(title).split(/\s+/); const lines = [''];
  for (const word of words) {
    const last = lines.length - 1;
    if (lines[last].length + word.length > 30 && lines[last]) lines.push(word);
    else lines[last] += `${lines[last] ? ' ' : ''}${word}`;
  }
  return lines.slice(0, 2).map(line => line.length > 33 ? `${line.slice(0, 30)}…` : line).join('\n');
}

export async function buildComposition(id: string, title: string, shots: Shot[], recordings: ShotResult[], transcript: Transcript) {
  const dir = jobDir(id); const composition = path.join(dir, 'composition'); await mkdir(composition, { recursive: true });
  await copyFile(require.resolve('gsap/dist/gsap.min.js'), path.join(composition, 'gsap.min.js'));
  await copyFile(path.join(dir, 'narration.wav'), path.join(composition, 'narration.wav'));
  const markup: string[] = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]; const recording = recordings.find(r => r.id === shot.id)!;
    const filename = `shot-${shot.id}${path.extname(recording.clip)}`;
    await copyFile(path.join(dir, recording.clip), path.join(composition, filename));
    markup.push(`<video id="media-${shot.id}" class="clip browser-video" src="${filename}" data-start="${shot.start}" data-duration="${shot.duration}" data-media-start="${recording.trimStart}" data-track-index="1" muted playsinline></video><p id="scene-label-${shot.id}" class="clip scene-title" data-start="${shot.start}" data-duration="${shot.duration}" data-track-index="2">${escapeHtml(shot.caption.slice(0, 75))}</p>`);
  }
  const captions = captionChunks(transcript).map((c, i) => `<div id="caption-${i}" class="clip caption" data-start="${c.start}" data-duration="${c.end - c.start}" data-track-index="3"><span>${escapeHtml(c.text)}</span></div>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=1080,height=1920"><title>${escapeHtml(title)}</title><script src="gsap.min.js"></script><style>
body{margin:0;font-family:Arial,sans-serif;color:#fff}#root{width:1080px;height:1920px;position:relative;overflow:hidden}.fill{position:absolute;inset:0;background:#172841}.clip{position:absolute;inset:0}.brand{position:absolute;left:60px;top:86px;font-size:28px;color:#a9c6ed}.title{position:absolute;left:60px;top:140px;width:960px;font-size:62px;line-height:1.12;font-weight:700;margin:0}.browser{position:absolute;left:45px;top:330px;width:990px;height:1275px;overflow:hidden;border-radius:16px;background:#fff}.chrome{height:48px;background:#e8edf5;display:flex;align-items:center;gap:10px;padding:0 18px;box-sizing:border-box;color:#34435a}.chrome span{width:10px;height:10px;border-radius:50%;background:#9cabc0}.chrome p{font-size:20px;margin-left:22px}.browser-video{inset:auto;left:45px;top:378px;width:990px;height:1227px;object-fit:cover}.scene-title{inset:auto;position:absolute;left:60px;top:270px;font-size:28px;color:#bfd1eb;max-width:960px}.caption{display:flex;align-items:flex-end;justify-content:center;box-sizing:border-box;padding:0 105px 235px;pointer-events:none}.caption span{background:#1c2436e8;border-radius:16px;padding:16px 24px;font-size:48px;font-weight:700;line-height:1.2;text-align:center}.footer{position:absolute;bottom:100px;left:60px;font-size:25px;color:#a9c6ed}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="${transcript.duration}" data-fps="30"><div id="backdrop" class="clip" data-start="0" data-duration="${transcript.duration}" data-track-index="0"><div class="fill"></div><div class="brand">Software, in a minute.</div><h1 class="title">${escapeHtml(safeTitle(title))}</h1><div class="browser"><div class="chrome"><span></span><span></span><span></span></div></div><div class="footer">Explore the project. Find your next tool.</div></div>${markup.join('')}${captions}<audio id="narration" class="clip" src="narration.wav" data-start="0" data-duration="${transcript.duration}" data-track-index="4"></audio></div><script>window.__timelines={main:gsap.timeline({paused:true})};</script></body></html>`;
  await writeFile(path.join(composition, 'index.html'), html);
  await writeFile(path.join(composition, 'hyperframes.json'), JSON.stringify({ name: 'tech-demo', entry: 'index.html', width: 1080, height: 1920, fps: 30 }, null, 2));
  return composition;
}
export async function editVideo(id: string, title: string, shots: Shot[], recordings: ShotResult[], transcript: Transcript) {
  const dir = jobDir(id); const render = path.join(dir, 'render'); await mkdir(render, { recursive: true });
  const captions = captionChunks(transcript);
  await writeFile(path.join(dir, 'captions.srt'), toSrt(captions));
  await writeFile(path.join(dir, 'captions.ass'), toAss(captions));
  const composition = await buildComposition(id, title, shots, recordings, transcript);
  const temporary = path.join(dir, 'final.partial.mp4');
  if (config.renderer === 'hyperframes') {
    const bin = path.resolve('node_modules/.bin/hyperframes');
    await run(bin, ['check', '--json'], { cwd: composition });
    await run(bin, ['render', '--quality', 'high', '--output', temporary], { cwd: composition, timeout: 1800000 });
  } else {
    await writeFile(path.join(render, 'title.txt'), titleLines(title));
    for (const shot of shots) {
      const recording = recordings.find(r => r.id === shot.id);
      if (!recording) throw new Error(`Missing clip ${shot.id}`);
      // All filter paths are fixed relative filenames, never user supplied shell/filter syntax.
      const filter = `scale=990:1226:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=990:1226:(ow-iw)/2:(oh-ih)/2:color=white,pad=1080:1920:45:378:color=0x172841,setsar=1,drawbox=x=45:y=330:w=990:h=48:color=0xe8edf5:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:textfile=title.txt:expansion=none:fontcolor=white:fontsize=52:x=60:y=145,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='Software, in a minute.':fontcolor=0xa9c6ed:fontsize=28:x=60:y=86`;
      await run('ffmpeg', ['-y', '-ss', String(recording.trimStart), '-i', path.join(dir, recording.clip), '-t', String(shot.duration), '-vf', filter, '-r', '30', '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', `${shot.id}.mp4`], { cwd: render });
    }
    await writeFile(path.join(render, 'concat.txt'), shots.map(s => `file '${s.id}.mp4'`).join('\n'));
    await copyFile(path.join(dir, 'captions.ass'), path.join(render, 'captions.ass'));
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '1', '-i', 'concat.txt', '-i', path.join(dir, 'narration.wav'), '-vf', 'ass=captions.ass', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-b:a', '192k', '-t', String(transcript.duration), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', temporary], { cwd: render });
  }
  await rename(temporary, path.join(dir, 'final.mp4'));
  await run('ffmpeg', ['-y', '-ss', String(Math.min(2, transcript.duration / 2)), '-i', path.join(dir, 'final.mp4'), '-frames:v', '1', '-update', '1', path.join(dir, 'poster.jpg')]);
}
