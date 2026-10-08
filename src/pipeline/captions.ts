import { Transcript, Shot, CaptionPosition } from '../lib/types';
export interface Caption { text: string; start: number; end: number; position?: CaptionPosition; }
export function captionChunks(transcript: Transcript): Caption[] {
  if (transcript.words.length) {
    const captions: Caption[] = [];
    let batch: typeof transcript.words = [];
    for (const word of transcript.words.filter(w => w.end > w.start)) {
      if (batch.length && (batch.map(w => w.text).join(' ').length + word.text.length > 54 || word.start - batch[0].start > 3.5)) {
        captions.push({ text: batch.map(w => w.text).join(' ').trim(), start: batch[0].start, end: batch.at(-1)!.end }); batch = [];
      }
      batch.push(word);
    }
    if (batch.length) captions.push({ text: batch.map(w => w.text).join(' ').trim(), start: batch[0].start, end: batch.at(-1)!.end });
    return captions;
  }
  return transcript.segments.flatMap(s => {
    const words = s.text.split(/\s+/); const chunks: string[] = []; let text = '';
    for (const word of words) {
      if (text.length + word.length > 50 && text) { chunks.push(text); text = ''; }
      text += `${text ? ' ' : ''}${word}`;
    }
    if (text) chunks.push(text);
    let position = s.start;
    return chunks.map(text => {
      const duration = (s.end - s.start) * text.split(/\s+/).length / words.length;
      const c = { text, start: position, end: position + duration }; position += duration; return c;
    });
  });
}
function stamp(time: number, ass = false) {
  const units = ass ? 100 : 1000;
  const ticks = Math.round(time * units);
  const seconds = Math.floor(ticks / units);
  return `${ass ? Math.floor(seconds / 3600) : String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}${ass ? '.' : ','}${String(ticks % units).padStart(ass ? 2 : 3, '0')}`;
}
export const toSrt = (captions: Caption[]) => captions.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n');
export const captionAnchor = (position: CaptionPosition = 'bottom-center') => position === 'top-center' ? { alignment: 8, x: 540, y: 288 } : position === 'bottom-left' ? { alignment: 1, x: 105, y: 1740 } : position === 'bottom-right' ? { alignment: 3, x: 975, y: 1740 } : { alignment: 2, x: 540, y: 1740 };
export function directedCaptions(transcript: Transcript, shots: Shot[]): Caption[] {
  return captionChunks(transcript).flatMap(c => shots.filter(s => s.start < c.end && s.start + s.duration > c.start).map(s => ({ ...c, start: Math.max(c.start, s.start), end: Math.min(c.end, s.start + s.duration), position: s.captionPosition || 'bottom-center' })));
}
export function toAss(captions: Caption[]) {
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,48,&H00FFFFFF,&H00FFFFFF,&H0036241C,&HDC36241C,-1,0,0,0,100,100,0,0,3,16,0,2,105,105,235,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return header + captions.map(c => { const a = captionAnchor(c.position); return `Dialogue: 0,${stamp(c.start, true)},${stamp(c.end, true)},Default,,0,0,0,,{\\an${a.alignment}\\pos(${a.x},${a.y})}${c.text.replace(/[{}\\\r\n]/g, '')}`; }).join('\n');
}
