import { NextRequest, NextResponse } from 'next/server';
import { verifyWorker, enqueueOwner } from '@/lib/server/queue';
import { workspaceStore } from '@/lib/server/store';
import { BackgroundWorker } from '@/lib/server/worker';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try { await verifyWorker(request); } catch { return NextResponse.json({ error: 'Worker authentication required' }, { status: 401 }); }
  const store = workspaceStore();
  const body = await request.json().catch(() => ({}));
  const owners = typeof body.ownerId === 'string' ? [body.ownerId] : await store.dueOwners(Date.now());
  for (const owner of owners) { await new BackgroundWorker(store).processOwner(owner); await enqueueOwner(owner, store); }
  return NextResponse.json({ processed: owners.length });
}
