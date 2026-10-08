import { Job, Research, Inventory, Script, Transcript, Shot, ShotResult, Stage, stages, stageLabels } from '../lib/types';
import { readArtifact, writeArtifact, saveJob, event, getJob, invalidate } from '../lib/store';
import { withJobLock } from '../lib/lock';
import { research } from './research';
import { explore, refreshInventoryCapture } from './explore';
import { captureMode, matchesCapture } from './browser';
import { writeScript } from './script';
import { generateSpeech } from './tts';
import { direct, visualDirector, directorRevision, validatePlan } from './direct';
import { recordShots, shotSignature } from './record';
import { editVideo } from './edit';
import { checkVideo } from './qa';
import { sleep } from '../lib/process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { jobDir } from '../lib/store';
import { resolveModelSettings } from '../lib/model-settings';
import { withModelSettings } from '../lib/llm';

export async function runPipeline(id: string) {
  return withJobLock(id, async () => {
    const job = await getJob(id);
    if (!job || ['APPROVED', 'SKIPPED', 'READY_FOR_REVIEW', 'FAILED'].includes(job.status)) return;
    if (!job.llm) { job.llm = await resolveModelSettings(); await saveJob(job); }
    return withModelSettings(job.llm, async () => {
    let active: Stage = 'RESEARCHING';
    let refreshingCapture = false;
    async function stage<T>(name: Stage, filename: string | null, work: () => Promise<T>): Promise<T> {
      active = name;
      if (job!.completed.includes(name) && filename) {
        try {
          if (name === 'TTS') await stat(path.join(jobDir(id), 'narration.wav'));
          if (name === 'RECORDING') {
            const clips = await readArtifact<ShotResult[]>(id, filename);
            if (clips.some(clip => !matchesCapture(clip))) throw new Error('Browser capture layout changed');
            const savedShots = await readArtifact<Shot[]>(id, 'shot-plan.json');
            if (savedShots.length !== clips.length || savedShots.some(s=>clips.find(c=>c.id===s.id)?.signature !== shotSignature(s))) throw new Error('Shot intent changed');
            await Promise.all(clips.map(clip => stat(path.join(jobDir(id), clip.clip))));
          }
          if (name === 'QA') await stat(path.join(jobDir(id), 'final.mp4'));
          return await readArtifact<T>(id, filename);
        }
        catch {
          if (name === 'RECORDING') {
            // A missing clip invalidates the assembled edit, while all surviving clips remain reusable.
            job!.completed = job!.completed.filter(s => !['RECORDING', 'EDITING', 'QA'].includes(s));
            await saveJob(job!);
          } else await invalidate(job!, name);
        }
      }
      job!.status = name; job!.error = undefined; event(job!, stageLabels[name]); await saveJob(job!);
      let value: T | undefined;
      // Retry just this stage, while recording and speech retain their own finer checkpoints.
      for (let attempt = 0; attempt < 2; attempt++) {
        try { value = await work(); break; }
        catch (error) { if (attempt === 1) throw error; event(job!, `${stageLabels[name]} · automatic retry: ${(error as Error).message.slice(0, 180)}`); await saveJob(job!); await sleep(1000); }
      }
      if (filename) await writeArtifact(id, filename, value);
      if (!job!.completed.includes(name)) job!.completed.push(name);
      job!.progress = job!.completed.length / stages.length; await saveJob(job!);
      return value as T;
    }
    try {
      const facts = await stage<Research>('RESEARCHING', 'research.json', () => research(job.url));
      job.title = facts.title; await saveJob(job);
      let inventory = await stage<Inventory>('EXPLORING', 'inventory.json', () => explore(id, facts));
      if (!matchesCapture(inventory) || inventory.directorRevision !== directorRevision) {
        refreshingCapture = true;
        active = 'EXPLORING'; job.status = 'EXPLORING';
        event(job, `Refreshing ${captureMode} browser visuals`); await saveJob(job);
        inventory = await refreshInventoryCapture(id, inventory);
        await writeArtifact(id, 'inventory.json', inventory);
        // Preserve the sourced script, speech, and shot timings; recapture only visuals.
        await invalidate(job, 'DIRECTING');
        refreshingCapture = false;
      }
      const script = await stage<Script>('SCRIPTING', 'script.json', () => writeScript(facts, inventory));
      const speech = await stage<Transcript>('TTS', 'transcript.json', () => generateSpeech(id, script));
      job.duration = speech.duration; await saveJob(job);
      const shots = await stage<Shot[]>('DIRECTING', 'shot-plan.json', async () => {
        const plan = await visualDirector(speech, inventory, facts, id);
        await writeArtifact(id, 'director-report.json', { ...plan.diagnostics, notes: plan.notes, directorRevision });
        for (const note of plan.notes) event(job, note.slice(0,250));
        return plan.shots;
      });
      const diagnostics = validatePlan(shots, inventory, speech);
      if (!diagnostics.passed) throw new Error('Saved visual plan is invalid; regenerate visuals.');
      await writeArtifact(id, 'diversity.json', diagnostics);
      let recordings = await stage<ShotResult[]>('RECORDING', 'recordings.json', () => recordShots(id, shots, inventory, async detail => { event(job, detail); await saveJob(job); }));
      if (!await stat(path.join(jobDir(id), 'final.mp4')).then(s => s.size > 0).catch(() => false)) job.completed = job.completed.filter(s => !['EDITING', 'QA'].includes(s));
      if (!job.completed.includes('EDITING')) await stage('EDITING', null, () => editVideo(id, job.title, shots, recordings, speech));
      let qa = await stage('QA', 'qa.json', () => checkVideo(id, facts, inventory, script, speech, shots, recordings));
      if (!qa.passed) {
        const failed = qa.checks.filter(c => !c.passed && c.severity === 'error');
        if (failed.some(c => ['sources', 'semantic'].includes(c.id))) throw new Error(`Narration QA failed: ${failed.map(c => c.detail).join('; ')}. Regenerate the script.`);
        if (failed.some(c=>['visual-plan','shot-signatures'].includes(c.id))) throw new Error('Visual direction QA failed. Regenerate visuals while preserving narration.');
        // Re-edit media defects once; re-record only clips whose coverage/page checks failed.
        event(job, 'Repairing failed media checks'); job.status = 'EDITING'; await saveJob(job);
        const repairedDiagrams: string[] = [];
        if (failed.some(c => c.id === 'diagram-evidence')) {
          const fallback = direct(speech, inventory);
          for (let i = 0; i < shots.length; i++) if (shots[i].type === 'diagram') { repairedDiagrams.push(shots[i].id); shots[i] = fallback.find(s=>s.id===shots[i].id)!; }
          await writeArtifact(id, 'shot-plan.json', shots);
          await writeArtifact(id, 'diversity.json', validatePlan(shots, inventory, speech));
          const report = await readArtifact<{ notes: string[] }>(id, 'director-report.json');
          await writeArtifact(id, 'director-report.json', { ...report, ...validatePlan(shots,inventory,speech), notes: [...report.notes, `QA replaced unsupported diagrams ${repairedDiagrams.join(', ')} with source assets`] });
        }
        const badShots = failed.filter(c => c.id.startsWith('clip-')).map(c => c.id.slice(5)).concat(repairedDiagrams);
        if (failed.some(c => c.id === 'pages')) badShots.push(...recordings.filter(r => /404|403|access denied|page not found/i.test(r.pageTitle)).map(r => r.id));
        if (badShots.length) {
          await writeArtifact(id, 'recordings.json', recordings.filter(r => !badShots.includes(r.id)));
          recordings = await recordShots(id, shots, inventory, async detail => { event(job, detail); await saveJob(job); });
        }
        await editVideo(id, job.title, shots, recordings, speech);
        qa = await checkVideo(id, facts, inventory, script, speech, shots, recordings);
        await writeArtifact(id, 'qa.json', qa);
        if (!qa.passed) throw new Error(`Video QA failed after automatic repair: ${qa.checks.filter(c => !c.passed && c.severity === 'error').map(c => c.label).join(', ')}.`);
      }
      job.qaScore = qa.score; job.status = 'READY_FOR_REVIEW'; job.progress = 1;
      event(job, 'Your video is ready for final review'); await saveJob(job);
    } catch (error) {
      job.status = 'FAILED'; job.failedStage = active; job.error = (error as Error).message;
      // Failed QA must run again on resume instead of returning a cached failure.
      // A failed layout refresh must retain scene identities used by the saved script.
      if (!refreshingCapture) job.completed = job.completed.filter(s => s !== active);
      event(job, job.error); await saveJob(job);
    }
    return job;
    });
  });
}
