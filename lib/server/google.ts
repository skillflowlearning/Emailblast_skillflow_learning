import { OAuth2Client } from 'google-auth-library';
import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { equalSecret, seal, unseal } from './secrets';
import type { WorkspaceStore } from './model';

const SEND = 'https://www.googleapis.com/auth/gmail.send';
const READ = 'https://www.googleapis.com/auth/gmail.readonly';
export function googleConfigured() { return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.NEXT_PUBLIC_APP_URL); }
function oauthClient() {
  if (!googleConfigured()) throw new Error('Configure GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and NEXT_PUBLIC_APP_URL.');
  return new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    new URL('/api/google/callback', process.env.NEXT_PUBLIC_APP_URL).href);
}
export async function startGoogleConnection(request: NextRequest, owner: string) {
  const role = request.nextUrl.searchParams.get('role') === 'seed' ? 'seed' : 'sender';
  const nonce = randomBytes(24).toString('base64url');
  const client = oauthClient(); const pkce = await client.generateCodeVerifierAsync();
  const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', state: nonce,
    scope: ['openid', 'email', READ, ...(role === 'sender' ? [SEND] : [])],
    code_challenge: pkce.codeChallenge, code_challenge_method: 'S256' as never });
  const response = NextResponse.redirect(url);
  response.cookies.set('mailflow_oauth', await seal({ owner, nonce, role, verifier: pkce.codeVerifier, expires: Date.now() + 600000 }),
    { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/google', maxAge: 600 });
  return response;
}
export async function finishGoogleConnection(request: NextRequest, owner: string, store: WorkspaceStore) {
  const pending = await unseal<{ owner: string; nonce: string; role: 'sender' | 'seed'; verifier: string; expires: number }>(request.cookies.get('mailflow_oauth')?.value || '');
  if (pending.owner !== owner || pending.expires < Date.now() || !equalSecret(pending.nonce, request.nextUrl.searchParams.get('state') || '')) throw new Error('Google connection request expired. Start again.');
  if (request.nextUrl.searchParams.has('error')) throw new Error('Google permission was not granted.');
  const client = oauthClient();
  const { tokens } = await client.getToken({ code: request.nextUrl.searchParams.get('code') || '', codeVerifier: pending.verifier });
  if (!tokens.id_token || !tokens.access_token) throw new Error('Google did not return the required tokens.');
  const identity = (await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_OAUTH_CLIENT_ID })).getPayload();
  if (!identity?.email_verified || (pending.role === 'sender' && !identity.hd)) throw new Error('Connect a Google Workspace sending mailbox. Seed inboxes may also use an owned personal Gmail account.');
  const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15000) });
  if (!profile.ok) throw new Error('Gmail read permission could not be verified.');
  const email = ((await profile.json()) as { emailAddress: string }).emailAddress.toLowerCase();
  const scopes = (tokens.scope || '').split(' ');
  if (!scopes.includes(READ) || (pending.role === 'sender' && !scopes.includes(SEND))) throw new Error('Required Gmail permissions were not granted.');
  const encrypted = tokens.refresh_token ? await seal(tokens.refresh_token) : undefined;
  await store.transact(owner, (workspace) => {
    if (workspace.connections.some((connection) => connection.email === email && connection.role !== pending.role && !connection.revoked)) throw new Error('Use a separate owned account for seed checks and sending.');
    const id = `${pending.role}:${email}`;
    const old = workspace.connections.find((connection) => connection.id === id);
    if (!encrypted && !old?.refreshToken) throw new Error('Offline access was not granted. Reconnect and grant permission.');
    workspace.connections = workspace.connections.filter((connection) => connection.id !== id);
    workspace.connections.push({ id, email, role: pending.role, refreshToken: encrypted || old!.refreshToken, scopes, connectedAt: Date.now() });
    if (pending.role === 'sender') {
      const domain = workspace.domains.find((domain) => domain.name === email.split('@')[1]);
      if (!domain) throw new Error('Add this mailbox’s exact sending domain before connecting it.');
      const mailbox = workspace.mailboxes.find((mailbox) => mailbox.email === email);
      if (mailbox) { mailbox.connectionId = id; mailbox.status = 'paused'; mailbox.lastControlAt = Date.now(); mailbox.health = { status: 'unchecked' }; }
      else workspace.mailboxes.push({ id: email, email, connectionId: id, displayName: email.split('@')[0], domainId: domain.id,
        dailyCap: 30, sentToday: 0, totalSent: 0, bouncesCount: 0, bounceRate: 0, recentSeedPlacements: [], assignedRecipientCount: 0, status: 'paused', health: { status: 'unchecked' } });
    }
  });
  const response = NextResponse.redirect(new URL('/domains?connected=1', process.env.NEXT_PUBLIC_APP_URL));
  response.cookies.delete('mailflow_oauth'); return response;
}
export function connectedTokenResolver(owner: string, store: WorkspaceStore) {
  const cache = new Map<string, { token: string; expires: number }>();
  return async (email: string) => {
    const existing = cache.get(email); if (existing && existing.expires > Date.now() + 60000) return existing.token;
    const workspace = await store.read(owner);
    const connection = workspace.connections.find((connection) => connection.email === email && !connection.revoked);
    if (!connection) throw new Error('Reconnect this Google Workspace mailbox.');
    const client = oauthClient(); client.setCredentials({ refresh_token: await unseal<string>(connection.refreshToken) });
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) throw new Error('Google authorization expired. Reconnect the mailbox.');
    cache.set(email, { token: credentials.access_token, expires: credentials.expiry_date || Date.now() + 300000 });
    if (credentials.refresh_token) {
      const token = await seal(credentials.refresh_token);
      await store.transact(owner, (workspace) => { const current = workspace.connections.find((item) => item.id === connection.id); if (current) current.refreshToken = token; });
    }
    return credentials.access_token;
  };
}
