import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/server/auth';
import { workspaceStore } from '@/lib/server/store';
import { saveNewCampaign } from '@/lib/server/campaigns';
import { enqueueOwner } from '@/lib/server/queue';
import { failure } from '@/lib/server/responses';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try { const workspace = await workspaceStore().read(await requireOwner(request)); return NextResponse.json({ campaigns: Object.values(workspace.campaigns).map(({ state }) => state.campaign).sort((a, b) => b.createdAt - a.createdAt) }); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try { const owner = await requireOwner(request); const store = workspaceStore(); const body = await request.json(); const id = await saveNewCampaign(store, owner, body);
    await enqueueOwner(owner, store); return NextResponse.json({ id }, { status: 201 }); }
  catch (error) { return failure(error); }
}
