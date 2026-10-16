import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/server/auth';
import { startGoogleConnection } from '@/lib/server/google';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try { return await startGoogleConnection(request, await requireOwner(request)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Google connection failed' }, { status: 400 }); }
}
