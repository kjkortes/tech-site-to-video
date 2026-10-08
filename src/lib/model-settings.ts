import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { config } from './config';
import { atomicJson } from './json';
import { modelOptionsSchema, reasoningEfforts, ModelChoice, ModelOptions, ModelProvider, ModelSettings, StudioModelSettings } from './model-options';

export function configuredModelProvider(): ModelProvider {
  if (config.llmProvider === 'auto') return config.llmKey ? 'api' : 'extractive';
  if (['api', 'codex', 'extractive'].includes(config.llmProvider)) return config.llmProvider as ModelProvider;
  throw new Error('LLM_PROVIDER must be auto, codex, api, or extractive');
}
export function environmentModelDefaults(provider = configuredModelProvider()): ModelOptions {
  return modelOptionsSchema.parse({ model: provider === 'codex' ? config.codexModel : provider === 'api' ? config.llmModel : '', effort: provider === 'codex' ? config.codexEffort : 'default', creativity: config.creativity });
}
const catalogSchema = z.object({ models: z.array(z.object({
  slug: modelOptionsSchema.shape.model, display_name: z.string().optional(), visibility: z.string().optional(),
  default_reasoning_level: z.string().optional(), input_modalities: z.array(z.string()).optional(),
  supported_reasoning_levels: z.array(z.object({ effort: z.string() })).optional(),
})) });
export async function modelCatalog(file = path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'models_cache.json')): Promise<ModelChoice[]> {
  // Only public model metadata is read. Authentication remains owned by the CLI.
  try {
    const catalog = catalogSchema.parse(JSON.parse(await readFile(/* turbopackIgnore: true */ file, 'utf8')));
    return catalog.models.filter(m => m.slug && m.visibility === 'list').map(m => ({ id: m.slug, name: m.display_name || m.slug,
      efforts: (m.supported_reasoning_levels || []).map(e => e.effort).filter((e): e is ModelOptions['effort'] => reasoningEfforts.includes(e as ModelOptions['effort'])),
      defaultEffort: reasoningEfforts.includes(m.default_reasoning_level as ModelOptions['effort']) ? m.default_reasoning_level as ModelOptions['effort'] : 'default',
      vision: !!m.input_modalities?.includes('image'),
    }));
  } catch { return []; }
}
export function validateModelOptions(input: ModelOptions, models: ModelChoice[]): ModelOptions {
  const options = modelOptionsSchema.parse(input);
  const model = models.find(m => m.id === options.model);
  if (model && options.effort !== 'default' && !model.efforts.includes(options.effort)) throw new Error(`${model.name} does not support reasoning effort ${options.effort}`);
  if (model && !model.vision) throw new Error(`${model.name} does not accept images required by the visual director`);
  return options;
}
const defaultsSchema = z.object({ codex: modelOptionsSchema.optional(), api: modelOptionsSchema.optional(), extractive: modelOptionsSchema.optional() });
async function savedDefaults() {
  try { return defaultsSchema.parse(JSON.parse(await readFile(path.join(config.dataDir, 'model-defaults.json'), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw new Error('Saved model defaults are invalid. Check model-defaults.json before generating.'); }
}
export async function getModelSettings(): Promise<StudioModelSettings> {
  const provider = configuredModelProvider();
  const environmentDefaults = environmentModelDefaults(provider);
  const models = provider === 'codex' ? await modelCatalog() : [];
  return { provider, environmentDefaults, defaults: (await savedDefaults())[provider] || environmentDefaults, models,
    catalogNote: provider === 'codex' ? models.length ? 'Models and supported efforts from the local Codex catalog. Availability depends on your account.' : 'Codex model catalog is unavailable. Use Codex default or enter a model ID; opening Codex refreshes its catalog.' : provider === 'api' ? 'Enter the model ID supported by your configured API endpoint. Reasoning effort is configured here for Codex only.' : 'Source excerpt mode does not use an LLM. Enable Codex in server configuration to use these controls.',
  };
}
export async function saveModelDefaults(options: ModelOptions | null) {
  const { provider, models } = await getModelSettings();
  const defaults = await savedDefaults();
  if (options === null) delete defaults[provider];
  else defaults[provider] = validateModelOptions(options, models);
  // Atomic replacement makes defaults immediately visible to the separate worker.
  await atomicJson(path.join(config.dataDir, 'model-defaults.json'), defaults);
  return getModelSettings();
}
export async function resolveModelSettings(overrides: Partial<ModelOptions> = {}, base?: ModelSettings): Promise<ModelSettings> {
  const current = await getModelSettings();
  const provider = base?.provider || current.provider;
  const { model, effort, creativity } = base || current.defaults;
  const options = modelOptionsSchema.parse({ model, effort, creativity, ...overrides });
  return { provider, ...validateModelOptions(options, provider === 'codex' ? await modelCatalog() : []) };
}
