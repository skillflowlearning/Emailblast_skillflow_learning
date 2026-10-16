import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireOwner, localMode } from '@/lib/server/auth';
import { workspaceStore } from '@/lib/server/store';
import { publicWorkspace } from '@/lib/server/model';
import { checkDomain, newDomain } from '@/lib/server/domains';
import { googleConfigured } from '@/lib/server/google';
import { enqueueOwner } from '@/lib/server/queue';
import { recalculateDue } from '@/lib/server/schedule';
import { failure } from '@/lib/server/responses';
import { reconcileDeliveries } from '@/lib/server/recovery';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const owner = await requireOwner(request); const workspace = await workspaceStore().read(owner);
    return NextResponse.json({ ...publicWorkspace(workspace), setup: { storage: localMode() ? 'local' : 'firestore', googleConfigured: googleConfigured(),
      liveEnabled: process.env.BLAST_PROVIDER_MODE === 'live', queueConfigured: Boolean(process.env.BLAST_TASKS_QUEUE), localWorker: localMode() } });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const owner = await requireOwner(request); const store = workspaceStore(); const body = await request.json();
    if (body.action === 'review-deliveries') {
      const result = await reconcileDeliveries(owner, store); await enqueueOwner(owner, store);
      return NextResponse.json(result);
    }
    if (body.action === 'verify-domain') {
      const snapshot = await store.read(owner); const domain = snapshot.domains.find((d) => d.id === body.id); if (!domain) throw new Error('Domain not found.');
      const dns = await checkDomain(domain);
      await store.transact(owner, (workspace) => { const current = workspace.domains.find((d) => d.id === body.id)!; current.dns = dns; current.verifiedAt = dns.issues.length ? undefined : Date.now(); });
    } else await store.transact(owner, (workspace) => {
      if (body.action === 'add-domain') {
        const domain = newDomain(body.name);
        if (workspace.domains.some((d) => d.name === domain.name)) throw new Error('This domain is already added.');
        workspace.domains.push(domain);
      } else if (body.action === 'domain-settings') {
        const domain = workspace.domains.find((d) => d.id === body.id); if (!domain) throw new Error('Domain not found.');
        if (typeof body.dkimSelector !== 'string' || !/^[a-zA-Z0-9_-]{1,63}$/.test(body.dkimSelector)) throw new Error('Enter a valid DKIM selector.');
        domain.dkimSelector = body.dkimSelector; domain.dailyBudget = Math.max(1, Math.min(150, Number(body.dailyBudget) || 90));
        domain.verifiedAt = undefined; domain.dns = undefined;
      } else if (body.action === 'health') {
        const mailbox = workspace.mailboxes.find((m) => m.id === body.id); if (!mailbox) throw new Error('Mailbox not found.');
        const domain = workspace.domains.find((d) => d.id === mailbox.domainId);
        if (!domain?.verifiedAt || !domain.dns || domain.dns.issues.length || Date.now() - domain.dns.checkedAt > 86400000) throw new Error('Pass fresh domain ownership and DNS checks first.');
        if (Math.max(mailbox.cooldownUntil || 0, domain.cooldownUntil || 0) > Date.now()) throw new Error('Wait for mailbox/domain cooldown before a recovery test.');
        if (workspace.healthJobs.some((job) => job.mailboxId === mailbox.id && ['queued', 'sending', 'waiting'].includes(job.status))) throw new Error('A health test is already pending.');
        if (Object.values(workspace.attempts).some((attempt) => attempt.mailboxId === mailbox.id && ['unknown', 'dispatching'].includes(attempt.status))) throw new Error('An uncertain delivery needs review before a new health test.');
        const seed = workspace.connections.find((c) => c.role === 'seed' && !c.revoked && c.email !== mailbox.email);
        if (!seed) throw new Error('Connect a separate seed inbox you own first.');
        const id = randomUUID(); workspace.healthJobs.push({ id, mailboxId: mailbox.id, seedEmail: seed.email, token: `health-${id}`, attempts: 0, status: 'queued', dueAt: Date.now() });
        mailbox.health = { status: 'checking', detail: 'Queued: send a seed probe, wait two minutes, then read its exact placement.' };
      } else if (body.action === 'mailbox-status') {
        const mailbox = workspace.mailboxes.find((m) => m.id === body.id); if (!mailbox) throw new Error('Mailbox not found.');
        const domain = workspace.domains.find((d) => d.id === mailbox.domainId);
        if (!['active', 'spare', 'paused'].includes(body.status)) throw new Error('Invalid mailbox status.');
        if (body.status !== 'paused') {
          if (domain?.status === 'paused' || mailbox.health?.status !== 'healthy' || Date.now() - (mailbox.health.checkedAt || 0) > 3600000
            || (mailbox.cooldownUntil && (Date.now() < mailbox.cooldownUntil || (mailbox.healthPassedAt || 0) < mailbox.cooldownUntil))) throw new Error('Pass a fresh health check after cooldown before activating this mailbox.');
          if (mailbox.healthFlaggedAt) { mailbox.dailyCap = 8; mailbox.healthFlaggedAt = undefined; mailbox.healthSentBaseline = mailbox.totalSent; mailbox.healthBounceBaseline = mailbox.bouncesCount; mailbox.recentSeedPlacements = []; }
        }
        mailbox.status = body.status; mailbox.lastControlAt = Date.now();
      } else if (body.action === 'disconnect') {
        const connection = workspace.connections.find((c) => c.id === body.id); if (!connection) throw new Error('Connection not found.');
        connection.revoked = true; connection.refreshToken = '';
        for (const mailbox of workspace.mailboxes) if (mailbox.connectionId === connection.id) { mailbox.status = 'paused'; mailbox.health = { status: 'unchecked' }; }
      } else throw new Error('Unknown workspace action.');
      recalculateDue(workspace);
    });
    await enqueueOwner(owner, store);
    return NextResponse.json(publicWorkspace(await store.read(owner)));
  } catch (error) { return failure(error); }
}
