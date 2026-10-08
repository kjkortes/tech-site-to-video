import { NextResponse } from 'next/server';
import { getJob, invalidate, saveJob, event, readArtifact, jobDir } from '@/lib/store';
import { actionSchema, Stage, QAReport } from '@/lib/types';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { withJobLock } from '@/lib/lock';
import { enqueue } from '@/lib/queue';
import { apiError, requireLocalMutation } from '@/lib/api';
import { approveScript, approveAudio, saveScript, backToScript, prepareNarration, archiveAudio, adoptAudioTranscript, scriptApproved, enterScriptReview } from '@/lib/reviews';
import { resolveModelSettings } from '@/lib/model-settings';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireLocalMutation(request);
    const { id } = await context.params; const input = actionSchema.parse(await request.json());
    const result = await withJobLock(id, async () => {
      const job = await getJob(id);
      if (!job) throw new Error('Project not found');

      if (input.llm) {
        if (!['regenerate', 'resume','regenerate-script'].includes(input.action)) throw new Error('Model settings can only change when resuming or regenerating');
        job.llm = await resolveModelSettings(input.llm, job.llm);
      }
      if(input.action==='approve-script')return approveScript(job,input.scriptVersion);
      if(input.action==='save-script')return saveScript(job,input.text||'',input.source||'edited',input.scriptVersion);
      if(input.action==='back-script')return backToScript(job);
      if(input.action==='generate-tts')return prepareNarration(job,'generated');
      if(input.action==='approve-audio')return approveAudio(job,input.scriptVersion,input.audioVersion,input.mismatchResolution==='proceed');
      if(input.action==='use-audio-transcript')return adoptAudioTranscript(job);
      if(input.action==='replace-audio') {
        if(job.status!=='AUDIO_REVIEW')throw new Error('Replace audio during audio review');
        await archiveAudio(job);await invalidate(job,'TTS');job.status='NARRATION_PENDING';event(job,'Choose replacement narration. The approved script and research are retained.');await saveJob(job);return job;
      }
      if(input.action==='regenerate-script') {
        if(job.status!=='SCRIPT_REVIEW')throw new Error('Regenerate during script review');
        await archiveAudio(job);job.scriptFeedback=input.feedback;await invalidate(job,'SCRIPTING');return job;
      }
      if (!['READY_FOR_REVIEW', 'APPROVED', 'SKIPPED', 'FAILED'].includes(job.status)) throw new Error('Wait for generation to finish before changing this project');
      if (input.action === 'approve') {
        if (job.status !== 'READY_FOR_REVIEW') throw new Error('Only a video that passed QA can be approved');
        const qa = await readArtifact<QAReport>(id, 'qa.json');
        if (!qa.passed || !await stat(path.join(jobDir(id), 'final.mp4')).then(s => s.size > 0).catch(() => false)) throw new Error('The video or QA report is missing. Regenerate before approval.');
        job.status = 'APPROVED'; event(job, 'Approved for download');
      } else if (input.action === 'skip') {
        job.status = 'SKIPPED'; event(job, 'Skipped during review');
      } else if (input.action === 'resume') {
        if (job.status !== 'FAILED') throw new Error('Only failed projects can be resumed');
        job.status = 'RECEIVED'; job.revision++; job.error = undefined; event(job, 'Resuming from saved progress');
      } else {
        const from: Record<typeof input.scope, Stage> = { full: 'RESEARCHING', script: 'SCRIPTING', voice: 'TTS', visuals: 'DIRECTING' };
        await archiveAudio(job);await invalidate(job, from[input.scope]);
        if(input.scope==='voice') {
          const script=await readArtifact<import('@/lib/types').Script>(id,'script.json');
          if(scriptApproved(job,script))job.status='NARRATION_PENDING';else return enterScriptReview(job,script);
        }
      }
      await saveJob(job); return job;
    });
    if (!result) return apiError(new Error('This project is being processed. Try again when the current stage finishes.'), 409);
    if (result.status === 'RECEIVED') await enqueue(id, result.revision).catch(console.error);
    return NextResponse.json({ job: result });
  } catch (error) { return apiError(error, 409); }
}
