import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { config } from './config';
import { Job, Stage, stages, ContentMode } from './types';
import { atomicJson } from './json';
import { resolveModelSettings } from './model-settings';
import { ModelOptions } from './model-options';
export { atomicJson } from './json';

let pool: Pool | undefined;
export const db = () => pool ||= new Pool({ connectionString: config.database });
export function jobDir(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid project identifier');
  return path.join(config.dataDir, 'jobs', id);
}
export async function saveJob(job: Job) {
  job.updatedAt = new Date().toISOString();
  if (config.database) {
    await db().query('INSERT INTO video_jobs(id, payload, updated_at) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET payload=$2, updated_at=$3', [job.id, job, job.updatedAt]);
  } else await atomicJson(path.join(jobDir(job.id), 'job.json'), job);
}
export async function getJob(id: string): Promise<Job | null> {
  jobDir(id);
  if (config.database) return (await db().query('SELECT payload FROM video_jobs WHERE id=$1', [id])).rows[0]?.payload || null;
  try { return JSON.parse(await readFile(path.join(jobDir(id), 'job.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function listJobs(): Promise<Job[]> {
  if (config.database) return (await db().query('SELECT payload FROM video_jobs ORDER BY updated_at DESC LIMIT 100')).rows.map(r => r.payload);
  const dir = path.join(config.dataDir, 'jobs');
  await mkdir(dir, { recursive: true });
  const jobs = await Promise.all((await readdir(dir)).filter(id => /^[0-9a-f-]{36}$/.test(id)).map(getJob));
  return jobs.filter((j): j is Job => !!j).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}
export async function createJob(url: string, overrides?: Partial<ModelOptions>, contentMode:ContentMode='promotional'): Promise<Job> {
  const llm = await resolveModelSettings(overrides);
  const job: Job = { llm, contentMode, id: randomUUID(), url, title: new URL(url).hostname, status: 'RECEIVED', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1, completed: [], progress: 0, detail: 'Waiting for the video worker', events: [] };
  await saveJob(job); return job;
}
export async function readArtifact<T>(id: string, name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(jobDir(id), name), 'utf8'));
}
export const writeArtifact = (id: string, name: string, value: unknown) => atomicJson(path.join(jobDir(id), name), value);
export function event(job: Job, message: string) {
  job.detail = message;
  job.events = [...job.events, { at: new Date().toISOString(), stage: job.status, message }].slice(-150);
}
export const artifactNames: Record<Stage, string[]> = {
  RESEARCHING: ['research.json'], EXPLORING: ['inventory.json', 'page-map.json', 'exploration', 'assets'], SCRIPTING: ['script.json','story-outline.json'],
  TTS: ['transcript.json', 'narration.wav', 'tts-progress.json', 'speech'], DIRECTING: ['shot-plan.json', 'director-report.json', 'diversity.json','walkthrough-report.json','walkthrough-state.json','coverage-report.json','retention-report.json','safe-area.json'],
  RECORDING: ['recordings.json', 'clips'], EDITING: ['final.mp4', 'poster.jpg', 'captions.srt', 'captions.ass', 'composition', 'render'], QA: ['qa.json'],
};
export async function invalidate(job: Job, from: Stage) {
  const downstream = stages.slice(stages.indexOf(from));
  for (const stage of downstream) for (const name of artifactNames[stage]) await rm(path.join(jobDir(job.id), name), { recursive: true, force: true });
  job.completed = job.completed.filter(s => !downstream.includes(s));
  job.revision++; job.status = 'RECEIVED'; job.error = undefined; job.failedStage = undefined;
  job.duration = undefined; job.qaScore = undefined; job.progress = job.completed.length / stages.length;
  event(job, `Regenerating from ${from.toLowerCase()}`); await saveJob(job);
}
