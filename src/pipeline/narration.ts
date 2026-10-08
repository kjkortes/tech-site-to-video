import path from 'node:path';
import { stat } from 'node:fs/promises';
import type { Script, Transcript, Job } from '../lib/types';
import { jobDir, readArtifact, writeArtifact } from '../lib/store';
import { scriptText } from '../lib/reviews';
import { run, probe } from '../lib/process';
export interface RecognizedSpeech {duration:number;words:Transcript['words'];segments:{text:string;start:number;end:number}[];language?:string;}
const tokens=(text:string)=>text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).filter(Boolean);
const equivalent=(a:string,b:string)=>a===b || (a.length>4 && b.length>4 && (a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length-b.length)<=1);
// Edit alignment preserves real ASR word positions. It never invents a reading clock.
export function matchWords(scriptWords:string[],spoken:string[]) {
  if(scriptWords.length>6000 || spoken.length>6000)throw new Error('Narration is too long for a short-video alignment');
  const rows=scriptWords.length+1,cols=spoken.length+1,table=new Uint16Array(rows*cols);
  for(let i=0;i<rows;i++)table[i*cols]=i;for(let j=0;j<cols;j++)table[j]=j;
  for(let i=1;i<rows;i++)for(let j=1;j<cols;j++)table[i*cols+j]=Math.min(table[(i-1)*cols+j]+1,table[i*cols+j-1]+1,table[(i-1)*cols+j-1]+(equivalent(scriptWords[i-1],spoken[j-1])?0:1));
  const pairs:{script:number;spoken:number}[]=[];let i=scriptWords.length,j=spoken.length;
  while(i && j) {
    const same=equivalent(scriptWords[i-1],spoken[j-1]),value=table[i*cols+j];
    if(value===table[(i-1)*cols+j-1]+(same?0:1)){if(same)pairs.push({script:i-1,spoken:j-1});i--;j--;}
    else if(value===table[(i-1)*cols+j]+1)i--;else j--;
  }
  return {pairs:pairs.reverse(),difference:table[rows*cols-1]/Math.max(1,scriptWords.length,spoken.length)};
}
export function alignNarration(script:Script,recognized:RecognizedSpeech,duration:number) {
  const words=recognized.words.filter(w=>w.text.trim());
  if(!words.length || !Number.isFinite(duration) || duration<=0)throw new Error('Uploaded narration has no real speech timestamps');
  for(let i=0;i<words.length;i++)if(!Number.isFinite(words[i].start)||!Number.isFinite(words[i].end)||words[i].start<0||words[i].end<=words[i].start||words[i].end>duration+.1 || i>0 && words[i].start<words[i-1].start)throw new Error('Transcription returned invalid word timestamps');
  const actualTokens=words.flatMap((w,index)=>tokens(w.text).map(text=>({text,index})));
  const approved=tokens(scriptText(script)),matched=matchWords(approved,actualTokens.map(w=>w.text));
  let scriptOffset=0,wordOffset=0;
  const segments:Transcript['segments']=[];
  for(let i=0;i<script.segments.length;i++) {
    const segment=script.segments[i];scriptOffset+=tokens(segment.text).length;
    const next=matched.pairs.find(p=>p.script>=scriptOffset);
    // Missing script clauses have no fabricated timestamps. Unmatched speech
    // remains in a real-word bucket; empty clauses are omitted and flagged by mismatch.
    const end=i===script.segments.length-1?words.length:next?actualTokens[next.spoken].index:wordOffset;
    if(end>wordOffset) {
      const spoken=words.slice(wordOffset,end);
      segments.push({...segment,text:spoken.map(w=>w.text).join(' '),start:spoken[0].start,end:spoken.at(-1)!.end});wordOffset=end;
    }
  }
  if(!segments.length)throw new Error('Speech could not be associated with the script; use the audio transcript or replace the audio');
  const transcript:Transcript={duration,words,segments,timingSource:'local-whisper-word-alignment'};
  const text=words.map(w=>w.text).join(' '),significant=matched.difference>.25;
  return {transcript,mismatch:{significant,difference:matched.difference,transcript:text,message:significant?'The uploaded narration differs from the approved script. Review the transcript before generating video.':'Narration matches the approved script, allowing minor recognition and pronunciation differences.'}};
}
export async function transcribeNarration(id:string):Promise<RecognizedSpeech> {
  const neighbor=path.resolve('../kokoro-local-tts/.venv/bin/python');
  const python=process.env.NARRATION_PYTHON || (await stat(neighbor).then(()=>true).catch(()=>false)?neighbor:'python3');
  try {await run(python,[path.resolve('scripts/transcribe-audio.py'),path.join(jobDir(id),'narration.wav'),path.join(jobDir(id),'audio-transcription.json')],{timeout:600000});}
  catch(error){throw new Error(`Local narration alignment failed: ${(error as Error).message}. Set NARRATION_PYTHON to a Python environment with faster-whisper, then resume; the upload is saved.`);}
  return readArtifact<RecognizedSpeech>(id,'audio-transcription.json');
}
export async function prepareUploadedSpeech(job:Job,script:Script):Promise<Transcript> {
  const audio=job.narration;if(audio?.source!=='uploaded' || !audio.inputFile)throw new Error('Uploaded narration file is missing');
  await run('ffmpeg',['-y','-i',path.join(jobDir(job.id),audio.inputFile),'-vn','-ar','48000','-c:a','pcm_s16le',path.join(jobDir(job.id),'narration.wav')]);
  const info=await probe(path.join(jobDir(job.id),'narration.wav')),duration=Number(info.format.duration);
  const recognized=await readArtifact<RecognizedSpeech>(job.id,'audio-transcription.json').catch(()=>null)||await transcribeNarration(job.id);
  const aligned=alignNarration(script,recognized,duration);audio.mismatch=aligned.mismatch;audio.alignment=aligned.transcript.timingSource;
  await writeArtifact(job.id,'audio-transcription.json',recognized);return aligned.transcript;
}
