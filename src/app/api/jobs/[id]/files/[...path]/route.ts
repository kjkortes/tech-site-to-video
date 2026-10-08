import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getJob, jobDir } from '@/lib/store';
import { apiError } from '@/lib/api';
export const runtime = 'nodejs';
const allowed = /^(final\.mp4|poster\.jpg|narration\.wav|captions\.srt|research\.json|inventory\.json|script\.json|script-quality\.json|transcript\.json|shot-plan\.json|qa\.json|director-report\.json|diversity\.json|recordings\.json|page-map\.json|story-outline\.json|walkthrough-report\.json|walkthrough-state\.json|coverage-report\.json|retention-report\.json|safe-area\.json|assets\/asset-\d+\.(png|jpg|webp|gif|mp4|webm)|clips\/\d+(-camera|-source|-actual-code)?\.(mp4|webm|png)|exploration\/scene-\d+\.png)$/;
const mime: Record<string, string> = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.webm': 'video/webm', '.wav': 'audio/wav', '.json': 'application/json', '.srt': 'application/x-subrip' };
export async function GET(request: Request, context: { params: Promise<{ id: string; path: string[] }> }) {
  try {
    const { id, path: parts } = await context.params; const relative = parts.join('/');
    if (!allowed.test(relative) || !await getJob(id)) return apiError(new Error('File not found'), 404);
    const file = path.join(jobDir(id), relative); const info = await stat(file);
    let start = 0, end = info.size - 1, status = 200;
    const headers = new Headers({ 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' });
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
      if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (start > end || start >= info.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
      status = 206; headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`);
    }
    headers.set('Content-Length', String(end - start + 1));
    if (new URL(request.url).searchParams.has('download')) headers.set('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
    const stream = Readable.toWeb(createReadStream(file, { start, end }));
    return new Response(stream as ReadableStream, { status, headers });
  } catch (error) { return apiError(error, 404); }
}
