import { z } from 'zod';
import { modelOptionsSchema, ModelSettings } from './model-options';

export const stages = ['RESEARCHING', 'EXPLORING', 'SCRIPTING', 'TTS', 'DIRECTING', 'RECORDING', 'EDITING', 'QA'] as const;
export type Stage = typeof stages[number];
export const reviewStates = ['SCRIPT_REVIEW','NARRATION_PENDING','AUDIO_REVIEW'] as const;
export type Status = 'RECEIVED' | typeof reviewStates[number] | Stage | 'READY_FOR_REVIEW' | 'APPROVED' | 'SKIPPED' | 'FAILED';
export const stageLabels: Record<Stage, string> = {
  RESEARCHING: 'Researching the product', EXPLORING: 'Finding useful visuals', SCRIPTING: 'Writing the story',
  TTS: 'Preparing narration', DIRECTING: 'Planning the shots', RECORDING: 'Capturing directed shots',
  EDITING: 'Assembling the video', QA: 'Checking picture and sound',
};
export const createJobSchema = z.object({ url: z.string().trim().url().max(2048), llm: modelOptionsSchema.partial().optional(), contentMode: z.enum(['promotional','tutorial','developer']).default('promotional') });
export const actionSchema = z.object({ action: z.enum(['approve', 'skip', 'resume', 'regenerate','approve-script','save-script','regenerate-script','generate-tts','approve-audio','back-script','use-audio-transcript','replace-audio']), scope: z.enum(['full', 'script', 'voice', 'visuals']).default('full'), llm: modelOptionsSchema.partial().optional(), text:z.string().min(1).max(20000).optional(), source:z.enum(['edited','user_provided']).optional(), feedback:z.string().max(2000).optional(), scriptVersion:z.number().int().positive().optional(), audioVersion:z.number().int().positive().optional(), mismatchResolution:z.literal('proceed').optional() });
export interface ScriptReview { version:number; source:'generated'|'edited'|'user_provided'; state:'generated'|'edited'|'user_provided'|'approved'; createdAt:string; approvedAt?:string; hash:string; }
export interface NarrationReview { version:number; source:'generated'|'uploaded'; state:'pending'|'ready'|'approved'|'stale'; scriptVersion:number; scriptHash:string; inputFile?:string; originalName?:string; format?:string; sampleRate?:number; duration?:number; hash?:string; transcriptHash?:string; createdAt:string; approvedAt?:string; alignment?:string; mismatch?:{significant:boolean; difference:number; transcript:string; message:string}; mismatchResolution?:'proceed'|'transcript'; }
export interface Job { scriptApproval?:{version:number;hash:string;approvedAt:string}; narration?:NarrationReview; scriptFeedback?:string; contentMode?: ContentMode;
  llm?: ModelSettings;
  id: string; url: string; title: string; status: Status; createdAt: string; updatedAt: string;
  revision: number; completed: Stage[]; error?: string; failedStage?: Stage;
  duration?: number; qaScore?: number; progress: number; detail: string;
  events: { at: string; stage: Status; message: string }[];
}
export interface Source { id: string; url: string; title: string; text: string; }
export interface Claim { id: string; text: string; sourceId: string; quote: string; }
export interface Research { title: string; description: string; sources: Source[]; claims: Claim[]; mode: 'model' | 'extractive'; editorial?: import('../pipeline/editorial').EditorialBrief; }
export const browserActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scroll'), text: z.string().max(200).optional(), y: z.number().min(0).max(30000).optional() }),
  z.object({ type: z.literal('click'), selector: z.string().max(300).optional(), text: z.string().max(120), role: z.enum(['button', 'link', 'tab']).default('button') }),
]);
export type BrowserAction = z.infer<typeof browserActionSchema>;
export interface Scene { id: string; url: string; title: string; description: string; actions: BrowserAction[]; screenshot: string; sourceId?: string; sectionId?: string; }
export interface PageSection { anchors?: { selector: string; scrollY: number; text: string }[]; id: string; pageId: string; sourceId: string; heading: string; order: number; parentId?: string; selector: string; scrollY: number; endY: number; text: string; assetIds: string[]; sceneId?: string; }
export interface DocumentPage { id: string; sourceId: string; url: string; title: string; order: number; sections: PageSection[]; }
export interface WalkLocation { pageId: string; sectionId: string; sectionIndex: number; url: string; scrollY: number; selector: string; heading: string; }
export interface WalkthroughIntent { visitId: string; location: WalkLocation; role: 'hook' | 'context' | 'cutaway' | 'return' | 'ending'; previousLocation?: WalkLocation; nextLocation?: WalkLocation; returnTarget?: WalkLocation; transition?: { from: WalkLocation; duration: number }; }
export interface StoryOutline { preferredProofClaimIds?: string[]; revision: number; editorial?: import('../pipeline/editorial').EditorialBrief; visits: { id: string; sectionId: string; sceneId: string; claimIds: string[]; purpose: string; reason: string; storyRole?: 'introduction'|'core-experience'|'proof'|'technical'|'surprise'|'differentiator'|'caveat' }[]; notes: string[]; }
export interface ContinuityReport { passed: boolean; score: number; browserDuration: number; cutawayDuration: number; issues: DiversityReport['issues']; }
export interface FocusRegion { x: number; y: number; width: number; height: number; } // normalized source coordinates
export type AssetType = 'image' | 'gif' | 'video' | 'section' | 'code' | 'demo';
export interface VisualAsset { captureMethod?: 'raw-media' | 'element'; isolated?: boolean;
  code?: { fontSize: number; lines: { number: number; region: FocusRegion }[] };
  sectionId?: string; documentOrder?: number; scrollY?: number;
  id: string; sceneId: string; sourceId?: string; type: AssetType; url: string; pageUrl: string;
  localPath?: string; description: string; features: string[]; width: number; height: number;
  quality: number; confidence: number; selector?: string; actions?: BrowserAction[]; text?: string;
  focus?: FocusRegion; canEnlarge: boolean; animated: boolean;
}
export const shotTypes = ['walkthrough', 'establish', 'scroll_to', 'media_fullscreen', 'zoom_region', 'pan_media', 'highlight', 'click_demo', 'video_playback', 'code_focus', 'feature_card', 'diagram'] as const;
export type ShotType = typeof shotTypes[number];
export type Framing = 'context' | 'product' | 'detail';
export type CameraMotion = 'hold' | 'slow-push' | 'slow-pull' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down';
export type CaptionPosition = 'bottom-center' | 'top-center' | 'bottom-left' | 'bottom-right';
export interface Diagram { nodes: { id: string; label: string }[]; edges: { from: string; to: string; evidence: string }[]; }
export interface DiversityReport { passed: boolean; score: number; scrollDuration: number; issues: { shotId?: string; code: string; detail: string; severity: 'error' | 'warning' }[]; }
export type ContentMode = 'promotional' | 'tutorial' | 'developer';
export type SourceType = 'website' | 'githubRepo' | 'documentation';
export type CameraMode = 'walkthrough' | 'media' | 'detail';
export interface Inventory { sourceUrl?: string; sourceType?: SourceType; contentMode?: ContentMode; pages?: DocumentPage[]; mapRevision?: number; assets?: VisualAsset[]; directorRevision?: number; scenes: Scene[]; notes: string[]; captureMode?: 'mobile' | 'desktop'; captureViewport?: { width: number; height: number }; captureRevision?: number; }
export interface ScriptSegment { takeawayClaimIds?: string[]; sectionId?: string; visitId?: string; id: string; text: string; sceneId: string; claimIds: string[]; }
export interface Script { quality?:import('../pipeline/script-quality').ScriptQualityReport; text?:string; review?:ScriptReview; contentMode?: ContentMode; outline?: StoryOutline; revision?: number; title: string; segments: ScriptSegment[]; mode: 'model' | 'extractive'; }
export interface TimedSegment extends ScriptSegment { start: number; end: number; }
export interface Transcript { duration: number; segments: TimedSegment[]; words: { text: string; start: number; end: number }[]; timingSource: string; }
export interface VisualSupport {
  visualRole?: 'demonstration' | 'product-context';
  id: string; beatId: string; assetId: string; sourceSectionId: string; claimIds: string[];
  supportedText: string; transcriptStart: number; transcriptEnd: number;
  visualStart: number; visualEnd: number; relevanceReason: string;
  minReadability: number; timingSource: 'words' | 'segment-estimate';
}
export interface CoverageReport { passed: boolean; groups: VisualSupport[]; issues: DiversityReport['issues']; }
export interface Shot { intro?: boolean; cameraMode?: CameraMode; contentMode?: ContentMode; sourceContext?: boolean; camera?: { focus?: FocusRegion; motion: CameraMotion; duration: number; offset: number; startX?: number; maxZoom?: number; reason?: string; detailText?: string }; support?: VisualSupport; contextPreview?: string; sourceOffset?: number; walkthrough?: WalkthroughIntent; narration?: string; codeRange?: { start: number; end: number }; type?: ShotType; assetId?: string; segmentId?: string; purpose?: string; rationale?: string; framing?: Framing; motion?: CameraMotion; focus?: FocusRegion; highlight?: FocusRegion; captionPosition?: CaptionPosition; diagram?: Diagram; directorRevision?: number; id: string; sceneId: string; start: number; duration: number; url: string; actions: BrowserAction[]; caption: string; }
export interface ShotResult { mediaIsolation?: { assetId: string; method: string; layers: number }; rawClip?: string; rawTrimStart?: number; signature?: string; kind?: 'browser' | 'asset' | 'generated'; consentObscured?: boolean; fallbackReason?: string; id: string; clip: string; duration: number; trimStart: number; attempts: number; fallback: boolean; pageTitle: string; captureMode?: 'mobile' | 'desktop'; captureViewport?: { width: number; height: number }; captureRevision?: number; }
export interface QACheck { id: string; label: string; passed: boolean; severity: 'error' | 'warning'; detail: string; }
export interface QAReport { score: number; passed: boolean; checks: QACheck[]; checkedAt: string; }
