import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { normalizeDomain, newDomain, launchIssues, domainCapacity } from '../lib/server/domains';
import { emptyWorkspace } from '../lib/server/model';
import { requireOwner } from '../lib/server/auth';
import { signature, seal, unseal } from '../lib/server/secrets';
import { GET as workerGet } from '../app/api/blast/worker/route';
import { POST as jobPost } from '../app/api/jobs/blast/route';
import { POST as unsubscribe } from '../app/api/unsubscribe/route';
import { startGoogleConnection } from '../lib/server/google';

process.env.BLAST_APP_SECRET = 'test-only-secret-with-at-least-32-characters';

test('subdomains and public suffixes are grouped under the actual registered domain', () => {
  assert.equal(normalizeDomain('MAIL.SkillFlowLearning.ORG').registeredDomain, 'skillflowlearning.org');
  assert.equal(normalizeDomain('outreach.skillflowlearning.org').registeredDomain, 'skillflowlearning.org');
  assert.equal(normalizeDomain('mail.business.co.in').registeredDomain, 'business.co.in');
  assert.throws(() => normalizeDomain('https://example.com/path'));
});

test('six mailboxes on a single registered domain cannot satisfy domain failover readiness', () => {
  const workspace = emptyWorkspace('owner'); const domain = newDomain('example.org');
  domain.verifiedAt = Date.now(); domain.dns = { checkedAt: Date.now(), ownership: true, mx: true, spf: true, dkim: true, dmarc: true, issues: [] }; workspace.domains.push(domain);
  for (let i = 0; i < 6; i++) {
    workspace.connections.push({ id: `c${i}`, email: `sender${i}@example.org`, role: 'sender', refreshToken: 'encrypted', scopes: [], connectedAt: Date.now() });
    workspace.mailboxes.push({ id: `m${i}`, email: `sender${i}@example.org`, connectionId: `c${i}`, displayName: 'Demo', domainId: domain.id, status: 'active', dailyCap: 30, sentToday: 0, totalSent: 0, bouncesCount: 0, bounceRate: 0, recentSeedPlacements: [], assignedRecipientCount: 0, health: { status: 'healthy', checkedAt: Date.now() } });
  }
  assert.ok(launchIssues(workspace, workspace.mailboxes.map((m) => m.id)).some((issue) => issue.includes('two different')));
});

test('subdomains share the registered domain budget instead of multiplying it', () => {
  const workspace = emptyWorkspace('owner'); workspace.domains.push(newDomain('mail.example.org'), newDomain('outreach.example.org'));
  const base = { connectionId: 'c', displayName: 'Demo', status: 'active' as const, dailyCap: 50, totalSent: 0, bouncesCount: 0, bounceRate: 0, recentSeedPlacements: [], assignedRecipientCount: 0, dailyResetDate: '2026-10-16' };
  workspace.mailboxes.push({ ...base, id: 'a', email: 'a@mail.example.org', domainId: 'mail.example.org', sentToday: 50 }, { ...base, id: 'b', email: 'b@outreach.example.org', domainId: 'outreach.example.org', sentToday: 40 });
  assert.deepEqual(domainCapacity(workspace, 'mail.example.org', '2026-10-16'), { used: 90, limit: 90 });
});

test('Google tokens are authenticated ciphertext and cannot be read or modified', async () => {
  const encrypted = await seal({ refreshToken: 'private-test-token' });
  assert.ok(!encrypted.includes('private-test-token'));
  assert.deepEqual(await unseal(encrypted), { refreshToken: 'private-test-token' });
  const parts = encrypted.split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  await assert.rejects(unseal(parts.join('.')));
});

test('signed local sessions are bound to localhost and cannot be forged', async () => {
  const value = `owner.${Date.now() + 60000}`; const signed = `${value}.${await signature(value)}`;
  assert.equal(await requireOwner(new NextRequest('http://localhost:3000/api/workspace', { headers: { cookie: `mailflow_session=${signed}` } })), 'owner');
  await assert.rejects(requireOwner(new NextRequest('http://localhost:3000/api/workspace', { headers: { cookie: 'mailflow_session=owner.9999999999999.forged' } })));
  await assert.rejects(requireOwner(new NextRequest('http://example.org/api/workspace', { headers: { cookie: `mailflow_session=${signed}` } })));
});

test('public requests cannot inspect worker state, invoke jobs, or unsubscribe arbitrary addresses', async () => {
  assert.equal((await workerGet(new NextRequest('http://localhost:3000/api/blast/worker'))).status, 401);
  assert.equal((await jobPost(new NextRequest('http://localhost:3000/api/jobs/blast', { method: 'POST' }))).status, 401);
  const response = await unsubscribe(new NextRequest('http://localhost:3000/api/unsubscribe', { method: 'POST', body: JSON.stringify({ email: 'other@example.org' }) }));
  assert.equal(response.status, 400);
});

test('OAuth connection uses offline access, a state nonce, PKCE, and purpose-limited scopes', async () => {
  const prior = [process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET, process.env.NEXT_PUBLIC_APP_URL];
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client'; process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret'; process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  try {
    const response = await startGoogleConnection(new NextRequest('http://localhost:3000/api/google/connect?role=seed'), 'owner');
    const destination = new URL(response.headers.get('location')!);
    assert.equal(destination.searchParams.get('access_type'), 'offline');
    assert.ok(destination.searchParams.get('state')); assert.ok(destination.searchParams.get('code_challenge'));
    assert.equal(destination.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(destination.searchParams.get('scope')?.includes('gmail.readonly'));
    assert.ok(!destination.searchParams.get('scope')?.includes('gmail.send'));
    assert.ok(response.cookies.get('mailflow_oauth')?.httpOnly);
  } finally {
    ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'NEXT_PUBLIC_APP_URL'].forEach((name, i) => { if (prior[i] === undefined) delete process.env[name]; else process.env[name] = prior[i]; });
  }
});
