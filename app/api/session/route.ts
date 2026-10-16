import { NextRequest, NextResponse } from 'next/server';
import { firebaseSession, sameOrigin, sessionResponse } from '@/lib/server/auth';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) { return sessionResponse(request); }
export async function POST(request: NextRequest) {
  try { return await firebaseSession(request); }
  catch { return NextResponse.json({ error: 'Sign-in could not be verified. Check Firebase Authentication setup.' }, { status: 401 }); }
}
export async function DELETE(request: NextRequest) {
  sameOrigin(request);
  const response = NextResponse.json({ success: true }); response.cookies.delete('mailflow_session'); return response;
}
