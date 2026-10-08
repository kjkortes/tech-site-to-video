import { NextResponse } from 'next/server';
import { createJob, listJobs } from '@/lib/store';
import { createJobSchema } from '@/lib/types';
import { validatePublicUrl } from '@/lib/network';
import { enqueue } from '@/lib/queue';
import { apiError, requireLocalMutation } from '@/lib/api';
export const runtime = 'nodejs';
export async function GET() {
  try { return NextResponse.json({ jobs: await listJobs() }); } catch (error) { return apiError(error, 500); }
}
export async function POST(request: Request) {
  try {
    requireLocalMutation(request);
    const input = createJobSchema.parse(await request.json());
    const url = await validatePublicUrl(input.url);
    const job = await createJob(url, input.llm);
    // Worker reconciliation recovers the durable job if Redis is temporarily unavailable.
    await enqueue(job.id, job.revision).catch(console.error);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) { return apiError(error); }
}
