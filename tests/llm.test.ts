import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../src/lib/config';
import { modelJson, modelProvider, modelEnabled, modelLabel, checkCodexLogin, withModelSettings, creativeInstruction } from '../src/lib/llm';

test('provider selection preserves API/excerpt defaults and explicitly enables Codex without an API key', () => {
  const saved = { ...config };
  try {
    config.llmProvider = 'auto'; config.llmKey = '';
    assert.equal(modelProvider(), 'extractive'); assert.equal(modelEnabled(), false);
    config.llmKey = 'test-key'; assert.equal(modelProvider(), 'api');
    config.llmProvider = 'codex'; config.llmKey = '';
    assert.equal(modelEnabled(), true); assert.match(modelLabel(), /Codex.*ChatGPT/);
    config.llmProvider = 'extractive'; config.llmKey = 'test-key'; assert.equal(modelEnabled(), false);
    config.llmProvider = 'typo'; assert.throws(modelProvider, /LLM_PROVIDER/);
  } finally { Object.assign(config, saved); }
});

test('Codex sends evidence over stdin, uses ChatGPT auth, validates output and cleans isolated requests', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'frameforge-codex-test-'));
  const saved = { ...config }; const oldEnv = { ...process.env }; const originalFetch = globalThis.fetch;
  const capture = path.join(directory, 'request.json'); const executable = path.join(directory, 'codex-fixture');
  await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('login')) { console.error(process.env.CODEX_FIXTURE_MODE === 'api-login' ? 'Logged in using an API key' : 'Logged in using ChatGPT'); process.exit(0); }
let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.CODEX_FIXTURE_CAPTURE, JSON.stringify({args,input,cwd:process.cwd(),apiKeyPresent:!!process.env.OPENAI_API_KEY || !!process.env.CODEX_API_KEY || !!process.env.CODEX_ACCESS_TOKEN || !!process.env.LLM_API_KEY}));
  if (process.env.CODEX_FIXTURE_MODE === 'timeout') { setInterval(() => {}, 1000); return; }
  if (process.env.CODEX_FIXTURE_MODE === 'failure') { console.error('Subscription usage limit reached'); process.exit(1); }
  const output = args[args.indexOf('--output-last-message') + 1];
  fs.writeFileSync(output, process.env.CODEX_FIXTURE_MODE === 'malformed' ? 'not JSON' : process.env.CODEX_FIXTURE_MODE === 'invalid' ? '{"answer":12}' : '{"answer":"Evidence checked"}');
});
`, { mode: 0o700 });
  let apiCalls = 0;
  globalThis.fetch = async () => { apiCalls++; throw new Error('Unexpected API billing path'); };
  try {
    config.llmProvider = 'codex'; config.codexBin = executable; config.codexTimeout = 2000;
    config.codexModel = ''; config.llmKey = 'unused-test-key';
    process.env.CODEX_FIXTURE_CAPTURE = capture;
    process.env.OPENAI_API_KEY = 'unused'; process.env.CODEX_API_KEY = 'unused'; process.env.CODEX_ACCESS_TOKEN = 'unused'; process.env.LLM_API_KEY = 'unused';
    const schema = z.object({ answer: z.string() });
    assert.equal((await checkCodexLogin()).ok, true);
    await withModelSettings({ provider: 'codex', model: 'fixture-director', effort: 'high', creativity: 'bold' }, () => modelJson('Write the hook', {}, schema, [], 'script'));
    const directedRequest = JSON.parse(await readFile(capture, 'utf8'));
    assert.equal(directedRequest.args[directedRequest.args.indexOf('--model') + 1], 'fixture-director');
    assert.ok(directedRequest.args.includes('model_reasoning_effort="high"'));
    assert.match(directedRequest.input, /inventive.*hook wording/);
    assert.equal(config.codexModel, '', 'Per-job choices must not mutate global configuration');
    assert.doesNotMatch(creativeInstruction(), /inventive.*hook wording/, 'Creative settings must leave their request scope');
    await withModelSettings({ provider: 'codex', model: 'fixture-director', effort: 'high', creativity: 'bold' }, () => modelJson('Select visits', {}, schema, [], 'navigation'));
    const navigationRequest=JSON.parse(await readFile(capture,'utf8'));
    assert.match(navigationRequest.input,/document order/);
    assert.doesNotMatch(navigationRequest.input,/Script creativity|inventive/);
    assert.ok(navigationRequest.args.includes('model_reasoning_effort="high"'));
    assert.deepEqual(await modelJson('Check the evidence', { text: 'Literal `$(echo hello)` source text' }, schema), { answer: 'Evidence checked' });
    await modelJson('Inspect the attached visual', {}, schema, [path.join(directory, 'public-source.jpg')]);
    const request = JSON.parse(await readFile(capture, 'utf8'));
    assert.ok(request.args.includes('--image'));
    assert.ok(request.args.includes(path.join(directory,'public-source.jpg')));
    // Read the first evidence call again for shell-text preservation below.
    await modelJson('Check the evidence', { text: 'Literal `$(echo hello)` source text' }, schema);
    const evidenceRequest = JSON.parse(await readFile(capture, 'utf8'));
    assert.match(evidenceRequest.input, /Literal `\$\(echo hello\)` source text/);
    assert.match(request.input, /untrusted evidence/);
    assert.ok(!request.args.some((arg: string) => arg.includes('Literal')));
    assert.ok(request.args.includes('forced_login_method="chatgpt"'));
    assert.ok(request.args.includes('read-only'));
    assert.ok(request.args.includes('features.shell_tool=false'));
    assert.equal(request.apiKeyPresent, false);
    assert.notEqual(request.cwd, process.cwd());
    assert.equal(await stat(request.cwd).then(() => true).catch(() => false), false);
    for (const mode of ['invalid', 'malformed', 'failure', 'timeout']) {
      process.env.CODEX_FIXTURE_MODE = mode;
      config.codexTimeout = mode === 'timeout' ? 200 : 2000;
      await assert.rejects(modelJson('Check', {}, schema), mode === 'timeout' ? /timed out/ : mode === 'failure' ? /usage limit/i : /JSON|invalid|expected/i);
      const failedRequest = JSON.parse(await readFile(capture, 'utf8'));
      assert.equal(await stat(failedRequest.cwd).then(() => true).catch(() => false), false);
    }
    process.env.CODEX_FIXTURE_MODE = 'api-login';
    assert.equal((await checkCodexLogin()).ok, false);
    await assert.rejects(modelJson('Check', {}, schema), /ChatGPT.*codex login/i);
    assert.equal(apiCalls, 0, 'Codex failures must never fall back to paid API calls');
    config.codexBin = path.join(directory, 'missing-codex');
    assert.match((await checkCodexLogin()).detail, /not found.*CODEX_BIN/i);
    await assert.rejects(modelJson('Check', {}, schema), /not found.*CODEX_BIN/i);
  } finally {
    Object.assign(config, saved); globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv); await rm(directory, { recursive: true, force: true });
  }
});

test('Codex requests recover a removed extension path and discover later upgrades without a restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-extension-upgrade-'));
  const saved = config.codexBin, savedPath = process.env.PATH;
  const bundle = process.platform === 'win32' ? 'windows-x86_64' : `${process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`;
  const executable = (version: string) => path.join(directory, 'extensions', `openai.chatgpt-${version}`, 'bin', bundle, 'codex');
  async function install(version: string) {
    const file = executable(version);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('login')) { console.error('Logged in using ChatGPT'); process.exit(0); }
if (!args.includes('exec')) process.exit(2);
process.stdin.resume(); process.stdin.on('end', () => {
  fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({answer: '${version}'}));
});
`, { mode: 0o700 });
    return file;
  }
  try {
    // The configured bundle was removed by an extension update. Its replacement
    // is not on the worker's restricted PATH.
    process.env.PATH = directory;
    config.codexBin = executable('26.9.1');
    await install('26.9.9');
    const latest = await install('26.10.1');
    // Recovery of an explicit extension choice should stay with that extension,
    // even when an unrelated installation is on PATH (including CI machines).
    await writeFile(path.join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex'), `#!${process.execPath}\nprocess.exit(1);\n`, { mode: 0o700 });
    await withModelSettings({ provider: 'codex', model: '', effort: 'default', creativity: 'balanced' }, async () => {
      assert.equal((await checkCodexLogin()).ok, true, 'A removed bundle path must resolve to the installed replacement');
      assert.deepEqual(await modelJson('Check', {}, z.object({ answer: z.string() })), { answer: '26.10.1' });
      await rm(path.dirname(path.dirname(path.dirname(latest))), { recursive: true });
      await install('26.11.1');
      assert.deepEqual(await modelJson('Check again', {}, z.object({ answer: z.string() })), { answer: '26.11.1' });
    });
  } finally {
    config.codexBin = saved;
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
    await rm(directory, { recursive: true, force: true });
  }
});

test('API sampling follows the task while preserving the selected model and creative script profile',async()=>{
  const saved={...config},originalFetch=globalThis.fetch;
  const requests:{temperature:number;model:string;messages:{content:string}[]}[]=[];
  try {
    config.llmKey='fixture';
    globalThis.fetch=async(_url,init)=>{requests.push(JSON.parse(init!.body as string));return Response.json({choices:[{message:{content:'{"answer":"ok"}'}}]});};
    await withModelSettings({provider:'api',model:'chosen-model',effort:'high',creativity:'bold'},async()=>{
      for(const task of ['research','mapping','navigation','visual','script','motion','qa'] as const) await modelJson('Task',{},z.object({answer:z.string()}),[],task);
    });
    assert.deepEqual(requests.map(r=>r.temperature),[.1,.1,.1,.1,.65,.3,.1]);
    assert.ok(requests.every(r=>r.model==='chosen-model'));
    assert.match(requests[4].messages[0].content,/inventive.*hook wording/);
    assert.doesNotMatch(requests[2].messages[0].content,/inventive|Script creativity/);
  } finally {Object.assign(config,saved);globalThis.fetch=originalFetch;}
});

test('concurrent model requests keep per-job choices isolated', async () => {
  const saved = { ...config }; const originalFetch = globalThis.fetch;
  try {
    config.llmProvider = 'api'; config.llmKey = 'test-key';
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      await new Promise(resolve => setTimeout(resolve, body.model === 'job-a' ? 20 : 1));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ answer: body.model }) } }] });
    };
    const schema = z.object({ answer: z.string() });
    const results = await Promise.all(['job-a', 'job-b'].map(model => withModelSettings({ provider: 'api', model, effort: 'default', creativity: 'balanced' }, async () => {
      await new Promise(resolve => setTimeout(resolve, model === 'job-a' ? 1 : 10));
      return modelJson('Check', {}, schema);
    })));
    assert.deepEqual(results, [{ answer: 'job-a' }, { answer: 'job-b' }]);
  } finally { Object.assign(config, saved); globalThis.fetch = originalFetch; }
});

test('API provider still uses its own endpoint and model and rejects a missing key', async () => {
  const saved = { ...config }; const originalFetch = globalThis.fetch;
  try {
    config.llmProvider = 'api'; config.llmKey = '';
    await assert.rejects(modelJson('Check', {}, z.object({ answer: z.string() })), /LLM_API_KEY/);
    config.llmKey = 'test-key'; config.llmBase = 'https://api.example.test/v1'; config.llmModel = 'existing-api-model';
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://api.example.test/v1/chat/completions');
      assert.equal(JSON.parse(init!.body as string).model, 'existing-api-model');
      return Response.json({ choices: [{ message: { content: '{"answer":"API checked"}' } }] });
    };
    assert.deepEqual(await modelJson('Check', {}, z.object({ answer: z.string() })), { answer: 'API checked' });
  } finally { Object.assign(config, saved); globalThis.fetch = originalFetch; }
});
