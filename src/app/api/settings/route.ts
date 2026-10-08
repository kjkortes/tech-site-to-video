import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireLocalMutation } from '@/lib/api';
import { modelOptionsSchema } from '@/lib/model-options';
import { getModelSettings, saveModelDefaults } from '@/lib/model-settings';

export const runtime = 'nodejs';
export async function GET() {
  try { return NextResponse.json(await getModelSettings()); } catch (error) { return apiError(error, 500); }
}
export async function PUT(request: Request) {
  try {
    requireLocalMutation(request);
    const input = z.object({ defaults: modelOptionsSchema.nullable() }).strict().parse(await request.json());
    return NextResponse.json(await saveModelDefaults(input.defaults));
  } catch (error) { return apiError(error); }
}
