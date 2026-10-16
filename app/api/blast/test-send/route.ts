import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/server/auth';
import { workspaceStore } from '@/lib/server/store';
import { failure } from '@/lib/server/responses';
import { POST as workspaceAction } from '@/app/api/workspace/route';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const owner = await requireOwner(request); const body = await request.json();
    if (process.env.BLAST_PROVIDER_MODE !== 'live') return NextResponse.json({ success: true, mode: 'simulation', notice: 'Simulation preview only. No real email sent.' });
    const workspace = await workspaceStore().read(owner);
    const mailbox = workspace.mailboxes.find((m) => m.email === body.fromEmail);
    if (!mailbox || !workspace.connections.some((c) => c.role === 'seed' && !c.revoked && c.email === body.toEmail)) throw new Error('Choose a connected sender and a separate owned seed inbox on the Domains page.');
    const response = await workspaceAction(new NextRequest(new URL('/api/workspace', request.url), { method: 'POST', headers: request.headers,
      body: JSON.stringify({ action: 'health', id: mailbox.id }) }));
    if (!response.ok) return response;
    return NextResponse.json({ success: true, mode: 'live', notice: 'Owned-seed health probe queued. Check its actual placement result on the Domains page.' });
  } catch (error) { return failure(error); }
}
