import type { Job } from './types';
export const waitingStatuses=['SCRIPT_REVIEW','NARRATION_PENDING','AUDIO_REVIEW','READY_FOR_REVIEW','APPROVED','SKIPPED','FAILED'];
export function runnable(job:Job) { return !waitingStatuses.includes(job.status); }
