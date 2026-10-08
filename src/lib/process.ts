import { spawn } from 'node:child_process';
export async function run(command: string, args: string[], options: { cwd?: string; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${command} timed out`)); }, options.timeout || 600000);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-200000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-20000); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); if (code === 0) resolve(stdout + (command === 'ffmpeg' ? stderr : '')); else reject(new Error(`${command} exited ${code}: ${stderr.slice(-2500)}`)); });
  });
}
export async function probe(file: string) {
  return JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file])) as { format: { duration: string; size: string }; streams: { codec_type: string; width?: number; height?: number; codec_name: string; sample_rate?: string; avg_frame_rate?: string }[] };
}
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
