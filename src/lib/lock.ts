import { mkdir, stat, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { jobDir } from './store';

// A shared per-job lease coordinates UI decisions and all worker backends.
export async function withJobLock<T>(id: string, work: () => Promise<T>): Promise<T | undefined> {
  const dir = jobDir(id); await mkdir(dir, { recursive: true });
  const lock = path.join(dir, '.lock');
  const token = randomUUID();
  try { await mkdir(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const age = Date.now() - (await stat(lock).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
    if (age < 120000) return undefined;
    await rm(lock, { recursive: true, force: true });
    try { await mkdir(lock); } catch { return undefined; }
  }
  await writeFile(path.join(lock, 'owner'), token);
  const beat = setInterval(async () => {
    const { utimes } = await import('node:fs/promises');
    await utimes(lock, new Date(), new Date()).catch(() => {});
  }, 10000);
  try { return await work(); }
  finally {
    clearInterval(beat);
    if (await readFile(path.join(lock, 'owner'), 'utf8').catch(() => '') === token) await rm(lock, { recursive: true, force: true });
  }
}
