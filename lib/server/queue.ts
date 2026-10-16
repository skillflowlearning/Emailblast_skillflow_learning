import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { WorkspaceStore } from './model';
import { NEVER } from './model';

export async function enqueueOwner(ownerId: string, store: WorkspaceStore) {
  const queue = process.env.BLAST_TASKS_QUEUE;
  if (!queue) return; // The separate local worker polls disk-backed workspaces.
  const workspace = await store.read(ownerId);
  if (workspace.nextDueAt === NEVER) return;
  const base = process.env.NEXT_PUBLIC_APP_URL; const serviceAccountEmail = process.env.BLAST_WORKER_SERVICE_ACCOUNT;
  if (!base?.startsWith('https://') || !serviceAccountEmail) throw new Error('Configure the HTTPS app URL and BLAST_WORKER_SERVICE_ACCOUNT.');
  const name = createHash('sha256').update(`${ownerId}:${workspace.version}:${workspace.nextDueAt}`).digest('hex');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  try {
    await client.request({ method: 'POST', url: `https://cloudtasks.googleapis.com/v2/${queue}/tasks`, data: { task: {
      name: `${queue}/tasks/${name}`, scheduleTime: new Date(Math.max(Date.now(), workspace.nextDueAt)).toISOString(),
      httpRequest: { httpMethod: 'POST', url: new URL('/api/jobs/blast', base).href,
        headers: { 'Content-Type': 'application/json' }, body: Buffer.from(JSON.stringify({ ownerId })).toString('base64'),
        oidcToken: { serviceAccountEmail, audience: new URL(base).origin } },
    } } });
  } catch (error) { if ((error as { response?: { status?: number } }).response?.status !== 409) throw error; }
}
export async function verifyWorker(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (!token || !process.env.NEXT_PUBLIC_APP_URL || !process.env.BLAST_WORKER_SERVICE_ACCOUNT) throw new Error('Worker authentication required.');
  const identity = (await new OAuth2Client().verifyIdToken({ idToken: token, audience: new URL(process.env.NEXT_PUBLIC_APP_URL).origin })).getPayload();
  if (!identity?.email_verified || identity.email !== process.env.BLAST_WORKER_SERVICE_ACCOUNT) throw new Error('Worker identity is not authorized.');
}
