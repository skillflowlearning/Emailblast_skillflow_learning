import { NextRequest, NextResponse } from 'next/server';
import { unseal } from '@/lib/server/secrets';
import { workspaceStore } from '@/lib/server/store';
import { recalculateDue } from '@/lib/server/schedule';
export const runtime = 'nodejs';
async function identity(token: string) {
  const data = await unseal<{ owner: string; email: string; expires: number }>(token);
  if (!data.owner || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.expires < Date.now()) throw new Error('Invalid unsubscribe link.');
  return data;
}
export async function GET(request: NextRequest) {
  try { const data = await identity(request.nextUrl.searchParams.get('token') || ''); return NextResponse.json({ email: data.email }); }
  catch { return NextResponse.json({ error: 'This unsubscribe link is invalid or expired.' }, { status: 400 }); }
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const data = await identity(request.nextUrl.searchParams.get('token') || body.token || '');
    await workspaceStore().transact(data.owner, (workspace) => {
      workspace.suppression[data.email] = { reason: 'Recipient unsubscribed', at: Date.now() };
      for (const saved of Object.values(workspace.campaigns)) for (const recipient of saved.state.recipients) if (recipient.email.toLowerCase() === data.email && recipient.status === 'pending') { recipient.status = 'skipped'; recipient.skipReason = 'Recipient unsubscribed'; }
      recalculateDue(workspace);
    });
    return NextResponse.json({ success: true, message: 'Unsubscribed successfully.' });
  } catch { return NextResponse.json({ error: 'This unsubscribe link is invalid or expired.' }, { status: 400 }); }
}
