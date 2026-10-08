import { z } from 'zod';

export const stages = ['RESEARCHING', 'EXPLORING', 'SCRIPTING', 'TTS', 'DIRECTING', 'RECORDING', 'EDITING', 'QA'] as const;
export type Stage = typeof stages[number];
export type Status = 'RECEIVED' | Stage | 'READY_FOR_REVIEW' | 'APPROVED' | 'SKIPPED' | 'FAILED';
export const stageLabels: Record<Stage, string> = {
  RESEARCHING: 'Researching the product', EXPLORING: 'Finding useful visuals', SCRIPTING: 'Writing the story',
  TTS: 'Generating narration', DIRECTING: 'Planning the shots', RECORDING: 'Recording the browser',
  EDITING: 'Assembling the video', QA: 'Checking picture and sound',
};
export const createJobSchema = z.object({ url: z.string().trim().url().max(2048) });
export const actionSchema = z.object({ action: z.enum(['approve', 'skip', 'resume', 'regenerate']), scope: z.enum(['full', 'script', 'voice', 'visuals']).default('full') });
export interface Job {
  id: string; url: string; title: string; status: Status; createdAt: string; updatedAt: string;
  revision: number; completed: Stage[]; error?: string; failedStage?: Stage;
  duration?: number; qaScore?: number; progress: number; detail: string;
  events: { at: string; stage: Status; message: string }[];
}
export interface Source { id: string; url: string; title: string; text: string; }
export interface Claim { id: string; text: string; sourceId: string; quote: string; }
export interface Research { title: string; description: string; sources: Source[]; claims: Claim[]; mode: 'model' | 'extractive'; }
export const browserActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scroll'), text: z.string().max(200).optional(), y: z.number().min(0).max(30000).optional() }),
  z.object({ type: z.literal('click'), selector: z.string().max(300).optional(), text: z.string().max(120), role: z.enum(['button', 'link', 'tab']).default('button') }),
]);
export type BrowserAction = z.infer<typeof browserActionSchema>;
export interface Scene { id: string; url: string; title: string; description: string; actions: BrowserAction[]; screenshot: string; sourceId?: string; }
export interface Inventory { scenes: Scene[]; notes: string[]; captureMode?: 'mobile' | 'desktop'; captureViewport?: { width: number; height: number }; captureRevision?: number; }
export interface ScriptSegment { id: string; text: string; sceneId: string; claimIds: string[]; }
export interface Script { title: string; segments: ScriptSegment[]; mode: 'model' | 'extractive'; }
export interface TimedSegment extends ScriptSegment { start: number; end: number; }
export interface Transcript { duration: number; segments: TimedSegment[]; words: { text: string; start: number; end: number }[]; timingSource: string; }
export interface Shot { id: string; sceneId: string; start: number; duration: number; url: string; actions: BrowserAction[]; caption: string; }
export interface ShotResult { id: string; clip: string; duration: number; trimStart: number; attempts: number; fallback: boolean; pageTitle: string; captureMode?: 'mobile' | 'desktop'; captureViewport?: { width: number; height: number }; captureRevision?: number; }
export interface QACheck { id: string; label: string; passed: boolean; severity: 'error' | 'warning'; detail: string; }
export interface QAReport { score: number; passed: boolean; checks: QACheck[]; checkedAt: string; }
