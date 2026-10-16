import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from './admin';
import { equalSecret, signature } from './secrets';

const COOKIE = 'mailflow_session';
export function localMode() { return process.env.NODE_ENV !== 'production' && process.env.BLAST_STORAGE !== 'firestore'; }
export function localRequest(request: NextRequest) { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname); }
export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin) throw new Error('Cross-origin requests are not allowed.');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new Error('Cross-site requests are not allowed.');
}
export async function requireOwner(request: NextRequest): Promise<string> {
  if (!['GET', 'HEAD'].includes(request.method)) sameOrigin(request);
  const cookie = request.cookies.get(COOKIE)?.value;
  if (!cookie) throw new Error('Sign in to continue.');
  if (localMode()) {
    if (!localRequest(request)) throw new Error('Local demo sessions are available on localhost only.');
    const [owner, expires, signed] = cookie.split('.');
    if (!owner || Number(expires) < Date.now() || !equalSecret(signed || '', await signature(`${owner}.${expires}`))) throw new Error('Session expired. Sign in again.');
    return owner;
  }
  return (await adminAuth().verifySessionCookie(cookie, true)).uid;
}
export async function sessionResponse(request: NextRequest) {
  try { const ownerId = await requireOwner(request); return NextResponse.json({ authenticated: true, ownerId, mode: localMode() ? 'local' : 'firebase' }); }
  catch {
    if (!localMode() || !localRequest(request)) return NextResponse.json({ authenticated: false, mode: 'firebase' });
    sameOrigin(request);
    const ownerId = randomUUID(); const expires = Date.now() + 30 * 86400000;
    const response = NextResponse.json({ authenticated: true, ownerId, mode: 'local' });
    response.cookies.set(COOKIE, `${ownerId}.${expires}.${await signature(`${ownerId}.${expires}`)}`, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 86400 });
    return response;
  }
}
export async function firebaseSession(request: NextRequest) {
  sameOrigin(request);
  const body = await request.json();
  const decoded = await adminAuth().verifyIdToken(body.idToken);
  if (!decoded.auth_time || Date.now() / 1000 - decoded.auth_time > 300) throw new Error('Please sign in again to create a session.');
  const cookie = await adminAuth().createSessionCookie(body.idToken, { expiresIn: 5 * 86400000 });
  const response = NextResponse.json({ authenticated: true, mode: 'firebase' });
  response.cookies.set(COOKIE, cookie, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 5 * 86400 });
  return response;
}
