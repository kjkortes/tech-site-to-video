import { NextResponse } from 'next/server';
import path from 'node:path';
import { writeFile, rm, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getJob, jobDir, saveJob, readArtifact } from '@/lib/store';
import { withJobLock } from '@/lib/lock';
import { prepareNarration, scriptApproved } from '@/lib/reviews';
import { requireLocalMutation, apiError } from '@/lib/api';
import { enqueue } from '@/lib/queue';
import { probe } from '@/lib/process';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
  let temporary:string|undefined;
  try {
    requireLocalMutation(request);const {id}=await context.params;
    if(Number(request.headers.get('content-length'))>105*1024*1024)throw new Error('Audio uploads are limited to 100 MB');
    const form=await request.formData(),file=form.get('audio');
    if(!(file instanceof File) || file.size===0 || file.size>100*1024*1024)throw new Error('Choose a non-empty WAV, MP3 or M4A file up to 100 MB');
    const extension=path.extname(file.name).toLowerCase();if(!['.wav','.mp3','.m4a'].includes(extension))throw new Error('Supported audio formats: WAV, MP3 and M4A');
    const result=await withJobLock(id,async()=>{
      const job=await getJob(id);if(!job)throw new Error('Project not found');
      const saved=await readArtifact<import('@/lib/types').Script>(id,'script.json');
      if(!scriptApproved(job,saved) || Number(form.get('scriptVersion'))!==saved.review?.version)throw new Error('Approve the current script before uploading narration');
      if(!['NARRATION_PENDING','AUDIO_REVIEW','FAILED'].includes(job.status))throw new Error('Wait for the current stage to finish');
      temporary=path.join(jobDir(id),`upload-${randomUUID()}${extension}`);await writeFile(temporary,Buffer.from(await file.arrayBuffer()));
      const info=await probe(temporary),stream=info.streams.find(s=>s.codec_type==='audio'),duration=Number(info.format.duration);
      if(!stream || !Number.isFinite(duration) || duration<=0 || duration>1800)throw new Error('Upload audible narration shorter than 30 minutes');
      await prepareNarration(job,'uploaded');
      const target=`audio-input${extension}`;await rename(temporary!,path.join(jobDir(id),target));temporary=undefined;
      Object.assign(job.narration!,{inputFile:target,originalName:file.name.slice(0,200),format:stream.codec_name,sampleRate:Number(stream.sample_rate),duration});
      await saveJob(job);return job;
    });
    if(!result)return apiError(new Error('This project is being processed. Wait for the current stage to finish.'),409);
    await enqueue(id,result.revision).catch(console.error);return NextResponse.json({job:result},{status:202});
  }catch(error){return apiError(error,409);}finally{if(temporary)await rm(temporary,{force:true}).catch(()=>{});}
}
