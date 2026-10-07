import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '../src/lib/config';
import { createJob, saveJob, jobDir, writeArtifact, getJob } from '../src/lib/store';
import { GET as fileGet } from '../src/app/api/jobs/[id]/files/[...path]/route';
import { POST as actionPost } from '../src/app/api/jobs/[id]/actions/route';
import { requireLocalMutation } from '../src/lib/api';

test('same-origin mutations use the browser-facing Host when Next normalizes the request URL', () => {
  const request = (host: string, origin: string) => new Request('http://localhost:3000/api/jobs', {
    method: 'POST', headers: { Host: host, Origin: origin },
  });
  assert.doesNotThrow(() => requireLocalMutation(request('127.0.0.1:3000', 'http://127.0.0.1:3000')));
  assert.doesNotThrow(() => requireLocalMutation(request('localhost:3000', 'http://localhost:3000')));
  assert.doesNotThrow(() => requireLocalMutation(request('192.168.1.20:3000', 'http://192.168.1.20:3000')));
  for (const origin of ['https://untrusted.example', 'http://127.0.0.1:3001', 'https://127.0.0.1:3000', 'null']) {
    assert.throws(() => requireLocalMutation(request('127.0.0.1:3000', origin)), /Cross-origin/);
  }
  assert.throws(() => requireLocalMutation(new Request('http://localhost:3000/api/jobs', {
    method: 'POST', headers: { Host: '127.0.0.1:3000', Origin: 'https://untrusted.example', 'X-Forwarded-Host': 'untrusted.example', 'X-Forwarded-Proto': 'https' },
  })), /Cross-origin/);
});

test('review API enforces final QA, exclusive transitions, safe files and video range playback', async () => {
  const original = config.dataDir; config.dataDir = await mkdtemp(path.join(tmpdir(), 'frameforge-api-'));
  try {
    const job = await createJob('https://example.com/');
    const context = { params: Promise.resolve({ id: job.id }) };
    const request = (action: string, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/jobs/actions', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ action }) });
    assert.equal((await actionPost(request('approve'), context)).status, 409, 'Active generation cannot be approved');
    job.status = 'READY_FOR_REVIEW'; await saveJob(job);
    assert.equal((await actionPost(request('approve'), context)).status, 409, 'Missing QA cannot be approved');
    await writeArtifact(job.id, 'qa.json', { passed: true });
    await writeFile(path.join(jobDir(job.id), 'final.mp4'), Buffer.from('0123456789'));
    assert.equal((await actionPost(request('approve', 'https://untrusted.example'), context)).status, 409);
    assert.equal((await actionPost(request('approve'), context)).status, 200);
    assert.equal((await getJob(job.id))?.status, 'APPROVED');
    const videoContext = { params: Promise.resolve({ id: job.id, path: ['final.mp4'] }) };
    const range = await fileGet(new Request('http://localhost:3000/video', { headers: { Range: 'bytes=2-5' } }), videoContext);
    assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await range.text(), '2345');
    const suffix = await fileGet(new Request('http://localhost:3000/video', { headers: { Range: 'bytes=-3' } }), videoContext);
    assert.equal(await suffix.text(), '789');
    assert.equal((await fileGet(new Request('http://localhost:3000/video', { headers: { Range: 'bytes=100-' } }), videoContext)).status, 416);
    assert.equal((await fileGet(new Request('http://localhost:3000/video'), { params: Promise.resolve({ id: job.id, path: ['..', 'job.json'] }) })).status, 404);
    job.status = 'FAILED'; await saveJob(job);
    const revision = job.revision;
    assert.equal((await actionPost(request('resume'), context)).status, 200);
    assert.equal((await getJob(job.id))?.revision, revision + 1, 'BullMQ resume requires a fresh dispatch identifier');
  } finally { await rm(config.dataDir, { recursive: true, force: true }); config.dataDir = original; }
});
