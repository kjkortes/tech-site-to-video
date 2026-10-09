import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveCodexExecutable } from '../src/lib/codex-executable';

test('Codex discovery honors PATH and explicit overrides without silently changing a custom installation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-discovery-'));
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const onPath = path.join(directory, 'commands', name);
  const custom = path.join(directory, 'custom', name);
  try {
    for (const file of [onPath, custom]) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, 'fixture', { mode: 0o700 });
    }
    const search = { home: directory, searchPath: path.dirname(onPath), extensionRoots: [] };
    assert.equal(await resolveCodexExecutable('codex', search), onPath);
    assert.equal(await resolveCodexExecutable(custom, search), custom);
    await rm(custom);
    await assert.rejects(resolveCodexExecutable(custom, search), /not found.*CODEX_BIN/);
    if (process.platform !== 'win32') {
      await writeFile(custom, 'not executable', { mode: 0o600 });
      await assert.rejects(resolveCodexExecutable(custom, search), /not executable/);
    }
    await assert.rejects(resolveCodexExecutable('custom-missing-command', search), /not found.*CODEX_BIN/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Codex discovery finds a standard home installation when the worker PATH is empty', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-local-install-'));
  const installed = path.join(directory, '.local', 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
  try {
    await mkdir(path.dirname(installed), { recursive: true });
    await writeFile(installed, 'fixture', { mode: 0o700 });
    assert.equal(await resolveCodexExecutable('codex', { home: directory, searchPath: '', extensionRoots: [] }), installed);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
