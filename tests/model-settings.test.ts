import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '../src/lib/config';
import { createJob, getJob, saveJob } from '../src/lib/store';
import { getModelSettings, saveModelDefaults, modelCatalog, validateModelOptions } from '../src/lib/model-settings';
import { modelOptionsSchema } from '../src/lib/model-options';
import { GET, PUT } from '../src/app/api/settings/route';
import { POST as actionPost } from '../src/app/api/jobs/[id]/actions/route';

test('model defaults persist, environment defaults can be restored, and jobs retain snapshots', async () => {
  const saved = { ...config };
  config.dataDir = await mkdtemp(path.join(tmpdir(), 'frameforge-settings-'));
  config.llmProvider = 'codex'; config.codexModel = 'fixture-model';
  config.codexEffort = 'medium'; config.creativity = 'balanced';
  try {
    const initial = await getModelSettings();
    assert.deepEqual(initial.defaults, { model: 'fixture-model', effort: 'medium', creativity: 'balanced' });
    const defaults = { model: 'custom-model', effort: 'high' as const, creativity: 'bold' as const };
    await saveModelDefaults(defaults);
    assert.deepEqual((await getModelSettings()).defaults, defaults);
    const job = await createJob('https://example.com', { effort: 'low', creativity: 'restrained' });
    assert.deepEqual(job.llm, { provider: 'codex', ...defaults, effort: 'low', creativity: 'restrained' });
    await saveModelDefaults({ ...defaults, model: 'different-model' });
    assert.equal((await getJob(job.id))?.llm?.model, 'custom-model');
    await saveModelDefaults(null);
    assert.deepEqual((await getModelSettings()).defaults, initial.defaults);
  } finally { await rm(config.dataDir, { recursive: true, force: true }); Object.assign(config, saved); }
});

test('catalog hides internal models, filters unsupported efforts, and accepts safe custom IDs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frameforge-catalog-'));
  try {
    const file = path.join(dir, 'models.json');
    await writeFile(file, JSON.stringify({ models: [
      { slug: 'fixture-vision', display_name: 'Fixture Vision', visibility: 'list', input_modalities: ['text','image'], default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'ultra' }] },
      { slug: 'internal-model', visibility: 'hide', supported_reasoning_levels: [{ effort: 'medium' }] },
    ] }));
    const models = await modelCatalog(file);
    assert.deepEqual(models.map(m => m.id), ['fixture-vision']);
    assert.deepEqual(models[0].efforts, ['low','medium','ultra']);
    assert.equal(models[0].vision, true);
    assert.throws(() => validateModelOptions({ model: 'fixture-vision', effort: 'high', creativity: 'balanced' }, models), /does not support.*high/);
    assert.doesNotThrow(() => validateModelOptions({ model: 'future/model-v2', effort: 'high', creativity: 'balanced' }, models));
    assert.equal(modelOptionsSchema.safeParse({ model: 'bad\n-c shell=true', effort: 'high', creativity: 'balanced' }).success, false);
    assert.deepEqual(await modelCatalog(path.join(dir, 'missing')), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('settings API enforces same-origin writes and regeneration applies only the selected override', async () => {
  const saved = { ...config };
  config.dataDir = await mkdtemp(path.join(tmpdir(), 'frameforge-settings-api-'));
  config.llmProvider = 'codex'; config.codexModel = 'fixture-model';
  try {
    const request = (body: unknown, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
    assert.equal((await PUT(request({ defaults: { model: 'new-model', effort: 'high', creativity: 'bold' } }, 'https://elsewhere.test'))).status, 400);
    assert.equal((await PUT(request({ defaults: { model: 'new-model', effort: 'high', creativity: 'bold' } }))).status, 200);
    assert.equal((await (await GET()).json()).defaults.model, 'new-model');
    const job = await createJob('https://example.com'); job.status = 'READY_FOR_REVIEW'; await saveJob(job);
    const act = (action: string, llm: unknown) => new Request('http://localhost:3000/api/jobs/actions', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: JSON.stringify({ action, scope: 'visuals', llm }) });
    const context = { params: Promise.resolve({ id: job.id }) };
    assert.equal((await actionPost(act('skip', { model: 'other-model' }), context)).status, 409);
    assert.equal((await actionPost(act('regenerate', { effort: 'low' }), context)).status, 200);
    assert.deepEqual((await getJob(job.id))?.llm, { provider: 'codex', model: 'new-model', effort: 'low', creativity: 'bold' });
    assert.equal((await getModelSettings()).defaults.effort, 'high');
  } finally { await rm(config.dataDir, { recursive: true, force: true }); Object.assign(config, saved); }
});
