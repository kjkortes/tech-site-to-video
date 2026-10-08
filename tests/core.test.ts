import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '../src/lib/config';
import { isPublicAddress, validatePublicUrl } from '../src/lib/network';
import { backedClaims } from '../src/pipeline/research';
import { validateScript } from '../src/pipeline/script';
import { direct } from '../src/pipeline/direct';
import { captionChunks, toSrt } from '../src/pipeline/captions';
import { createJob, getJob, invalidate, jobDir, writeArtifact } from '../src/lib/store';
import { withJobLock } from '../src/lib/lock';
import { Inventory, Research, Script, Transcript } from '../src/lib/types';

const research: Research = { title: 'Fixture', description: '', mode: 'extractive', sources: [{ id: 'source-1', title: 'Fixture', url: 'https://example.com/', text: 'This project converts Markdown documents into searchable notes.' }], claims: [{ id: 'claim-1', text: 'Searchable notes', sourceId: 'source-1', quote: 'This project converts Markdown documents into searchable notes.' }] };
const inventory: Inventory = { notes: [], scenes: [{ id: 'scene-1', title: 'Overview', url: 'https://example.com/', screenshot: 'exploration/scene-1.png', sourceId: 'source-1', description: '', actions: [] }] };
const script: Script = { title: 'Fixture', mode: 'extractive', segments: [{ id: 'seg-1', text: research.claims[0].quote, sceneId: 'scene-1', claimIds: ['claim-1'] }] };

test('public URL boundary rejects loopback, private, metadata and mapped addresses', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '0.0.0.0', '224.0.0.1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  await assert.rejects(validatePublicUrl('file:///etc/passwd'));
  await assert.rejects(validatePublicUrl('http://user:pass@example.com'));
  await assert.rejects(validatePublicUrl('http://127.0.0.1'));
});
test('fabricated citations and undiscovered visuals cannot enter a script', () => {
  assert.equal(backedClaims([{ text: 'Free forever', sourceId: 'source-1', quote: 'This is completely free forever.' }], research.sources).length, 0);
  assert.doesNotThrow(() => validateScript(script, research, inventory));
  assert.throws(() => validateScript({ ...script, segments: [{ ...script.segments[0], sceneId: 'invented' }] }, research, inventory));
  assert.throws(() => validateScript({ ...script, segments: [{ ...script.segments[0], claimIds: ['fake'] }] }, research, inventory));
  assert.throws(() => validateScript(script, research, { ...inventory, scenes: [{ ...inventory.scenes[0], sourceId: 'source-2' }] }));
});
test('shot timing covers initial silence, speech pauses and final audio exactly', () => {
  const transcript: Transcript = { duration: 9.2, timingSource: 'kokoro', words: [], segments: [
    { ...script.segments[0], start: 0.2, end: 3.2 },
    { ...script.segments[0], id: 'seg-2', start: 3.6, end: 9 },
  ] };
  const shots = direct(transcript, inventory);
  assert.equal(shots[0].start, 0); assert.equal(shots[0].duration, 3.6);
  assert.equal(shots[1].start, 3.6); assert.equal(shots.at(-1)!.start + shots.at(-1)!.duration, transcript.duration);
  assert.equal(shots.reduce((sum, s) => sum + s.duration, 0), transcript.duration);
});
test('GitHub context-only inventories retain source identity and bounded narration timing', () => {
  const overview = { ...inventory.scenes[0], url: 'https://github.com/storytold/photocraft', title: 'Product overview' };
  const feature = { ...overview, id: 'scene-2', title: 'Features', actions: [{ type: 'scroll' as const, text: 'Features', y: 3000 }] };
  const otherOverview = { ...overview, id: 'scene-3', sourceId: 'source-2', url: 'https://github.com/other/repo' };
  const scenes = { notes: [], scenes: [otherOverview, overview, feature] };
  const transcript: Transcript = { duration: 20, timingSource: 'kokoro', words: [], segments: [
    { ...script.segments[0], sceneId: feature.id, start: 0.2, end: 9.5 },
    { ...script.segments[0], id: 'seg-2', sceneId: feature.id, start: 10, end: 20 },
  ] };
  const shots = direct(transcript, scenes);
  assert.equal(shots[0].sceneId, feature.id, 'Context-only opening retains its actual narrated section');
  assert.deepEqual(shots[0].actions, []);
  assert.ok(shots.every(s=>s.duration <= 4.5));
  assert.ok(shots.some(s=>s.sceneId === feature.id));
  assert.ok(shots.every(s=>s.sceneId !== otherOverview.id));
  assert.equal(shots.at(-1)!.start + shots.at(-1)!.duration, 20);
});
test('caption chunks retain word timing and normalize timestamp carry', () => {
  const transcript: Transcript = { duration: 62, timingSource: 'kokoro', segments: [], words: [{ text: 'Hello', start: 59.9996, end: 60.5 }, { text: 'world.', start: 60.5, end: 61 }] };
  const captions = captionChunks(transcript);
  assert.equal(captions[0].text, 'Hello world.');
  assert.match(toSrt(captions), /00:01:00,000 --> 00:01:01,000/);
});
test('leases exclude concurrent decisions; voice regeneration preserves expensive upstream work', async () => {
  const originalDir = config.dataDir;
  config.dataDir = await mkdtemp(path.join(tmpdir(), 'frameforge-test-'));
  try {
    const job = await createJob('https://example.com/');
    job.completed = ['RESEARCHING', 'EXPLORING', 'SCRIPTING', 'TTS', 'DIRECTING', 'RECORDING', 'EDITING', 'QA'];
    await writeArtifact(job.id, 'research.json', research);
    await writeArtifact(job.id, 'script.json', script);
    await writeArtifact(job.id, 'transcript.json', { duration: 60 });
    await writeArtifact(job.id, 'qa.json', { passed: true });
    await withJobLock(job.id, async () => {
      const blocked = await withJobLock(job.id, async () => 'should not run');
      assert.equal(blocked, undefined);
    });
    assert.equal(await withJobLock(job.id, async () => 'released'), 'released');
    await invalidate(job, 'TTS');
    assert.deepEqual((await getJob(job.id))?.completed, ['RESEARCHING', 'EXPLORING', 'SCRIPTING']);
    await stat(path.join(jobDir(job.id), 'research.json'));
    await stat(path.join(jobDir(job.id), 'script.json'));
    await assert.rejects(stat(path.join(jobDir(job.id), 'transcript.json')));
    await assert.rejects(stat(path.join(jobDir(job.id), 'qa.json')));
    assert.equal(job.revision, 2);
  } finally { await rm(config.dataDir, { recursive: true, force: true }); config.dataDir = originalDir; }
});
