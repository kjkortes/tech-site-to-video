import { NextResponse } from 'next/server';
import { getJob, invalidate, saveJob, event, readArtifact, jobDir } from '@/lib/store';
import { actionSchema, Stage, QAReport } from '@/lib/types';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { withJobLock } from '@/lib/lock';
import { enqueue } from '@/lib/queue';
import { apiError, requireLocalMutation } from '@/lib/api';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireLocalMutation(request);
    const { id } = await context.params; const input = actionSchema.parse(await request.json());
    const result = await withJobLock(id, async () => {
      const job = await getJob(id);
      if (!job) throw new Error('Project not found');
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
        const from: Record<typeof input.scope, Stage> = { full: 'RESEARCHING', script: 'SCRIPTING', voice: 'TTS', visuals: 'RECORDING' };
        await invalidate(job, from[input.scope]);
      }
      await saveJob(job); return job;
    });
    if (!result) return apiError(new Error('This project is being processed. Try again when the current stage finishes.'), 409);
    if (result.status === 'RECEIVED') await enqueue(id, result.revision).catch(console.error);
    return NextResponse.json({ job: result });
  } catch (error) { return apiError(error, 409); }
}
