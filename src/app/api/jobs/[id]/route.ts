import { NextResponse } from 'next/server';
import { getJob, readArtifact } from '@/lib/store';
import { apiError } from '@/lib/api';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const job = await getJob(id);
    if (!job) return apiError(new Error('Project not found'), 404);
    const [research, inventory, script, transcript, qa, shots, director, diversity, continuity, outline, coverage, retention] = await Promise.all(['research.json', 'inventory.json', 'script.json', 'transcript.json', 'qa.json', 'shot-plan.json', 'director-report.json', 'diversity.json','walkthrough-report.json','story-outline.json','coverage-report.json','retention-report.json'].map(file => readArtifact(id, file).catch(() => null)));
    return NextResponse.json({ job, research, inventory, script, transcript, qa, shots, director, diversity, continuity, outline, coverage, retention });
  } catch (error) { return apiError(error); }
}
