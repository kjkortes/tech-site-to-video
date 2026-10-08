import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { Job } from '../src/lib/types';
import type { ModelOptions, StudioModelSettings } from '../src/lib/model-options';

// Exercise real studio components against isolated HTTP fixtures. No real job or
// workspace defaults are changed, and no model/TTS/video generation is started.
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const failures: string[] = [];
page.on('pageerror', error => failures.push(error.message));
const defaults: ModelOptions = { model: '', effort: 'medium', creativity: 'balanced' };
let settings: StudioModelSettings = { provider: 'codex', defaults: { ...defaults }, environmentDefaults: { ...defaults }, catalogNote: 'Fixture model catalog', models: [
  { id: 'fixture-vision', name: 'Fixture GPT', defaultEffort: 'medium', efforts: ['low','medium','high'], vision: true },
  { id: 'fixture-fast', name: 'Fixture Fast GPT', defaultEffort: 'low', efforts: ['low','medium'], vision: true },
] };
let job: Job | undefined;
let actions = 0;
await page.route('**/api/**', async route => {
  const request = route.request(); const pathname = new URL(request.url()).pathname;
  let body: unknown;
  if (pathname === '/api/settings') {
    if (request.method() === 'PUT') settings = { ...settings, defaults: request.postDataJSON().defaults || { ...defaults } };
    body = settings;
  } else if (pathname === '/api/health') body = { worker: true, tts: true, ttsState: 'ready', model: 'Codex (ChatGPT)', modelReady: true, modelDetail: '', renderer: 'ffmpeg' };
  else if (pathname === '/api/jobs') {
    if (request.method() === 'POST') {
      const input = request.postDataJSON();
      assert.equal(input.llm.provider, undefined, 'Client override must contain only editable fields');
      job = { id: '11111111-1111-1111-1111-111111111111', url: input.url, title: 'Fixture video', status: 'FAILED', revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completed: ['RESEARCHING','EXPLORING','SCRIPTING','TTS'], progress: .5, detail: 'Fixture saved for regeneration', events: [], llm: { provider: 'codex', ...settings.defaults, ...input.llm } };
      body = { job };
    } else body = { jobs: job ? [job] : [] };
  } else if (pathname.endsWith('/actions')) {
    const input = request.postDataJSON();
    assert.equal(input.action, 'regenerate'); assert.equal(input.scope, 'visuals');
    assert.equal(input.llm.provider, undefined);
    job = { ...job!, llm: { ...job!.llm!, ...input.llm }, revision: job!.revision + 1 };
    actions++; body = { job };
  } else body = { job, research: null, inventory: null, script: null, transcript: null, qa: null };
  await route.fulfill({ json: body });
});
try {
  await page.goto(process.env.STUDIO_TEST_URL || 'http://127.0.0.1:3000');
  await page.getByRole('button', { name: 'Studio settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('GPT model', { exact: true }).selectOption('fixture-vision');
  await dialog.getByLabel('Reasoning effort').selectOption('high');
  await dialog.getByLabel('Creative direction').selectOption('bold');
  await dialog.getByRole('button', { name: 'Save defaults' }).click();
  await page.getByRole('status').filter({ hasText: 'Model defaults saved' }).waitFor();
  assert.deepEqual(settings.defaults, { model: 'fixture-vision', effort: 'high', creativity: 'bold' });
  await mkdir('test-output', { recursive: true });
  await page.screenshot({ path: 'test-output/model-settings-desktop.png' });
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.reload();
  await page.locator('.create-panel summary').click();
  const create = page.getByRole('region', { name: 'Create a video' });
  assert.equal(await create.getByLabel('GPT model', { exact: true }).inputValue(), 'fixture-vision');
  await create.getByLabel('Reasoning effort').selectOption('low');
  await create.getByLabel('Creative direction').selectOption('restrained');
  await create.getByLabel('Website or GitHub URL').fill('https://example.com');
  await create.getByRole('button', { name: 'Start project' }).click();
  await page.locator('.project-model summary').click();
  assert.equal(job?.llm?.effort, 'low'); assert.equal(settings.defaults.effort, 'high');
  const project = page.locator('.project-model');
  await project.getByLabel('GPT model', { exact: true }).selectOption('fixture-fast');
  assert.equal(await project.getByLabel('Reasoning effort').inputValue(), 'low');
  assert.equal(await project.getByLabel('Reasoning effort').locator('option[value="high"]').count(), 0);
  await project.getByLabel('Reasoning effort').selectOption('medium');
  await project.getByLabel('Creative direction').selectOption('balanced');
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await page.getByRole('button', { name: 'Visuals & edit', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Regeneration queued' }).waitFor();
  assert.equal(actions, 1);
  assert.deepEqual(job?.llm, { provider: 'codex', model: 'fixture-fast', effort: 'medium', creativity: 'balanced' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Show studio settings' }).click();
  await dialog.getByRole('button', { name: 'Restore environment defaults' }).click();
  await page.getByRole('status').filter({ hasText: 'Environment defaults restored' }).waitFor();
  assert.deepEqual(settings.defaults, defaults);
  await dialog.getByLabel('GPT model', { exact: true }).selectOption('__custom__');
  await dialog.getByLabel('Custom model ID').fill('future/model-v2');
  await page.screenshot({ path: 'test-output/model-settings-mobile.png' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile UI must not overflow horizontally');
  assert.deepEqual(failures, []);
  console.log('Settings UI passed: saved defaults, reload, submission overrides, supported efforts, regeneration, reset, custom ID, mobile layout.');
} finally { await browser.close(); }
