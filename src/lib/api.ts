import { NextResponse } from 'next/server';
export function apiError(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : 'The request could not be completed';
  return NextResponse.json({ error: message }, { status });
}
export function requireLocalMutation(request: Request) {
  // Prevent another website from triggering expensive work against this local service.
  const origin = request.headers.get('origin');
  const expected = new URL(request.url);
  // Next.js can normalize 127.0.0.1 to localhost in request.url. The Host
  // header retains the authority the browser actually used, including its port.
  const host = request.headers.get('host');
  if (host) expected.host = host;
  if (origin && origin !== expected.origin) throw new Error('Cross-origin requests are not allowed');
}
