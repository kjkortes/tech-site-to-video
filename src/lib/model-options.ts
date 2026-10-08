import { z } from 'zod';

export const reasoningEfforts = ['default', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export const creativeDirections = ['restrained', 'balanced', 'bold'] as const;
export const modelOptionsSchema = z.object({
  model: z.string().trim().max(160).regex(/^(?:[a-zA-Z0-9][a-zA-Z0-9._:/-]*)?$/, 'Use a model ID without spaces or command options'),
  effort: z.enum(reasoningEfforts),
  creativity: z.enum(creativeDirections),
}).strict();
export type ModelOptions = z.infer<typeof modelOptionsSchema>;
export type ModelProvider = 'codex' | 'api' | 'extractive';
export type ModelSettings = ModelOptions & { provider: ModelProvider };
export interface ModelChoice { id: string; name: string; efforts: ModelOptions['effort'][]; defaultEffort: ModelOptions['effort']; vision: boolean; }
export interface StudioModelSettings { provider: ModelProvider; defaults: ModelOptions; environmentDefaults: ModelOptions; models: ModelChoice[]; catalogNote: string; }
export const effortLabels: Record<ModelOptions['effort'], string> = { default: 'Model default', low: 'Low · faster', medium: 'Medium · balanced', high: 'High · deeper planning', xhigh: 'Extra high', max: 'Maximum', ultra: 'Ultra' };
export const creativityLabels: Record<ModelOptions['creativity'], string> = { restrained: 'Restrained · straightforward', balanced: 'Balanced · engaging', bold: 'Bold · inventive storytelling' };
