import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/server/auth';
import { workspaceStore } from '@/lib/server/store';
import { authorizeTemporaryTest, temporarySenderKey, sendTemporaryBatch, TestRequestError } from '@/lib/temporary-test/server';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get('content-length')) > 100000) return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
    const body = await request.json(); authorizeTemporaryTest();
    const owner = await requireOwner(request);
    if (body.action === 'prepare') return NextResponse.json({ senderKey: temporarySenderKey() }, { headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json(await sendTemporaryBatch(owner, body, { store: workspaceStore() }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof TestRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Test request could not be completed. Check sign-in and server configuration. No automatic retry.' }, { status: 400 });
  }
}
