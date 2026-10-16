import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/server/auth';
import { workspaceStore } from '@/lib/server/store';
import { googleConfigured } from '@/lib/server/google';
import { recalculateDue } from '@/lib/server/schedule';
import { enqueueOwner } from '@/lib/server/queue';
import { failure } from '@/lib/server/responses';
export const runtime = 'nodejs';
async function status(owner: string) {
  const workspace = await workspaceStore().read(owner);
  return { killSwitchActive: workspace.killSwitch, providerMode: process.env.BLAST_PROVIDER_MODE === 'live' ? 'live' : 'simulation',
    canRunLive: googleConfigured(), seedEmails: workspace.connections.filter((c) => c.role === 'seed' && !c.revoked).map((c) => c.email), workerHeartbeat: workspace.workerHeartbeat };
}
export async function GET(request: NextRequest) { try { return NextResponse.json(await status(await requireOwner(request))); } catch (error) { return failure(error); } }
export async function POST(request: NextRequest) {
  try {
    const owner = await requireOwner(request); const body = await request.json();
    if (body.action === 'status') return NextResponse.json(await status(owner));
    if (body.action !== 'kill' && body.action !== 'unkill') return NextResponse.json({ error: 'Sending now uses saved campaigns and the authenticated background worker.' }, { status: 410 });
    const store = workspaceStore();
    await store.transact(owner, (workspace) => { workspace.killSwitch = body.action === 'kill'; recalculateDue(workspace); });
    await enqueueOwner(owner, store); return NextResponse.json({ success: true });
  } catch (error) { return failure(error); }
}
