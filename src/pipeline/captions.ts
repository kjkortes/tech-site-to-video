import { Transcript, Shot, CaptionPosition } from '../lib/types';
import { verticalSafeArea, contains, intersects } from './safe-area';
export interface Caption { text: string; start: number; end: number; position?: CaptionPosition; lines?: string[]; fontSize?: number; }
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
export const toSrt = (captions: Caption[]) => captions.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${(c.lines||[c.text]).join('\n')}\n`).join('\n');
// Legacy position arguments are accepted on old jobs, but never alter delivery.
export const captionAnchor = (_position: CaptionPosition = 'bottom-center') => ({ alignment: 2, x: 474, y: 1512 });
function textWidth(text: string, size: number) {
  return [...text].reduce((n,c)=>n+size*(/\s/.test(c)?.3:/[MWmw@%]/.test(c)?.98:/[ilI.,!:;'|]/.test(c)?.3:/[A-Z0-9]/.test(c)?.77:.68),0);
}
export function captionLayout(text: string) {
  const width=verticalSafeArea.captions.width-64;
  for(const fontSize of [48,46,44,42]) {
    const lines:string[]=[];let line='';
    for(const word of text.split(/\s+/).filter(Boolean)) {
      if(line && textWidth(`${line} ${word}`,fontSize)>width){lines.push(line);line='';}
      if(textWidth(word,fontSize)>width) {
        for(const char of word){if(textWidth(line+char,fontSize)>width){lines.push(line);line='';}line+=char;}
      } else line+=`${line?' ':''}${word}`;
    }
    if(line)lines.push(line);
    if(lines.length<=2)return {lines,fontSize};
  }
  throw new Error('Caption cannot fit two readable lines; split its timed words');
}
export function directedCaptions(transcript: Transcript, _shots: Shot[]): Caption[] {
  const safe:Caption[]=[];
  // Repack real word timestamps into two lines; visual cuts never restart a subtitle.
  const words=transcript.words.filter(w=>w.end>w.start);
  if(words.length) {
    let batch:typeof words=[];
    const flush=()=>{if(!batch.length)return;const text=batch.map(w=>w.text).join(' ');safe.push({text,start:batch[0].start,end:Math.min(transcript.duration,batch.at(-1)!.end),position:'bottom-center',...captionLayout(text)});batch=[];};
    for(const word of words) {
      if(batch.length) {
        try{captionLayout([...batch,word].map(w=>w.text).join(' '));if(word.start-batch[0].start>3.5)flush();}
        catch{flush();}
      }
      try{captionLayout(word.text);batch.push(word);if(/[.!?]["')\]]?$/.test(word.text))flush();}catch{
        flush();const pieces=word.text.match(/.{1,24}/gu)||[word.text];pieces.forEach((text,i)=>safe.push({text,start:word.start+(word.end-word.start)*i/pieces.length,end:Math.min(transcript.duration,word.start+(word.end-word.start)*(i+1)/pieces.length),position:'bottom-center',...captionLayout(text)}));
      }
    }
    flush();
  } else {
    const estimated=transcript.segments.flatMap(s=>{const tokens=s.text.split(/\s+/).filter(Boolean);return tokens.map((text,i)=>({text,start:s.start+(s.end-s.start)*i/tokens.length,end:s.start+(s.end-s.start)*(i+1)/tokens.length}));});
    if(estimated.length)return directedCaptions({...transcript,words:estimated},_shots);
  }
  return safe;
}
export function captionRect(caption: Caption) {
  const layout=caption.lines?{lines:caption.lines,fontSize:caption.fontSize||48}:captionLayout(caption.text);
  const width=Math.min(verticalSafeArea.captions.width,Math.max(...layout.lines.map(l=>textWidth(l,layout.fontSize)))+32),height=layout.lines.length*layout.fontSize*1.2+20;
  return {x:captionAnchor().x-width/2,y:captionAnchor().y-height,width,height};
}
export function validateCaptions(captions: Caption[]) {
  return captions.every(c=>c.position==='bottom-center' && (c.fontSize||48)>=42 && (c.lines||captionLayout(c.text).lines).length<=2 && contains(verticalSafeArea.captions,captionRect(c)) && ![verticalSafeArea.rightControls,verticalSafeArea.bottomControls].some(zone=>intersects(zone,captionRect(c))));
}
export function toAss(captions: Caption[]) {
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,48,&H00FFFFFF,&H00FFFFFF,&H0036241C,&HDC36241C,-1,0,0,0,100,100,0,0,3,10,0,2,112,244,408,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR,MarginV, Effect, Text\n`;
  return header + captions.map(c => { const a=captionAnchor(),layout=c.lines?{lines:c.lines,fontSize:c.fontSize||48}:captionLayout(c.text);const text=layout.lines.map(line=>line.replace(/[{}\\\r\n]/g,'')).join('\\N');return `Dialogue: 0,${stamp(c.start,true)},${stamp(c.end,true)},Default,,0,0,0,,{\\an2\\pos(${a.x},${a.y})\\fs${layout.fontSize}}${text}`; }).join('\n');
}
