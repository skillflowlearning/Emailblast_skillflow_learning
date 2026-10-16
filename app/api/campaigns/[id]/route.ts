import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/server/auth';
import { workspaceStore } from '@/lib/server/store';
import { campaignState, controlCampaign } from '@/lib/server/campaigns';
import { enqueueOwner } from '@/lib/server/queue';
import { failure } from '@/lib/server/responses';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  try { const owner = await requireOwner(request); const workspace = await workspaceStore().read(owner); return NextResponse.json({ state: campaignState(workspace, (await context.params).id), killSwitch: workspace.killSwitch, workerHeartbeat: workspace.workerHeartbeat }); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, context: Context) {
  try { const owner = await requireOwner(request); const id = (await context.params).id; const store = workspaceStore(); const body = await request.json();
    await store.transact(owner, (workspace) => controlCampaign(workspace, id, body.action, body.target)); await enqueueOwner(owner, store);
    return NextResponse.json({ state: campaignState(await store.read(owner), id) }); }
  catch (error) { return failure(error); }
}
