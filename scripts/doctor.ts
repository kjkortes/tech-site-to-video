import { config } from '../src/lib/config';
import { run } from '../src/lib/process';
import { launchBrowser } from '../src/pipeline/browser';
const checks: { name: string; ok: boolean; detail: string }[] = [];
for (const cmd of ['ffmpeg', 'ffprobe']) {
  try { const out = await run(cmd, ['-version'], { timeout: 5000 }); checks.push({ name: cmd, ok: true, detail: out.split('\n')[0] }); }
  catch { checks.push({ name: cmd, ok: false, detail: `Install ${cmd} using your system package manager` }); }
}
try { const browser = await launchBrowser(); await browser.close(); checks.push({ name: 'Chromium', ok: true, detail: 'Headless browser launches' }); }
catch { checks.push({ name: 'Chromium', ok: false, detail: 'Run npm run setup:browser' }); }
try {
  const response = await fetch(`${config.ttsBase}/api/status`, { signal: AbortSignal.timeout(5000) });
  const status = await response.json(); checks.push({ name: 'Kokoro', ok: response.ok && status.state !== 'error', detail: `${config.ttsBase}: ${status.state}` });
} catch { checks.push({ name: 'Kokoro', ok: false, detail: `Start ../kokoro-local-tts/run.sh; expected ${config.ttsBase}` }); }
checks.push({ name: 'Research', ok: true, detail: config.llmKey ? `Model: ${config.llmModel}` : 'Source excerpt mode; set LLM_API_KEY for model-assisted writing and exploration' });
const [major, minor] = process.versions.node.split('.').map(Number);
checks.push({ name: 'Node', ok: major > 22 || (major === 22 && (config.renderer !== 'hyperframes' || minor >= 12)), detail: `${process.version}; HyperFrames renderer requires >=22.12` });
for (const check of checks) console.log(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
if (checks.some(c => !c.ok)) process.exitCode = 1;
