import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/server/auth';
import { finishGoogleConnection } from '@/lib/server/google';
import { workspaceStore } from '@/lib/server/store';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try { return await finishGoogleConnection(request, await requireOwner(request), workspaceStore()); }
  catch { const response = NextResponse.redirect(new URL('/domains?connectionError=1', process.env.NEXT_PUBLIC_APP_URL || request.url)); response.cookies.delete('mailflow_oauth'); return response; }
}
