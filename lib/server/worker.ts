import { createHash, randomUUID } from 'node:crypto';
import { BlastEngine, sendingDate, inSendingWindow } from '../services/blastEngine';
import { MockMailProvider, MockBounceSource, MockSeedChecker } from '../services/blastProviders';
import { GmailMailProvider, GmailBounceSource, GmailSeedChecker } from '../services/gmailProvider';
import type { MailProvider, SendEmailParams, SeedChecker } from '../types/blast';
import type { Workspace, WorkspaceStore, SavedCampaign, HealthJob } from './model';
import { connectedTokenResolver } from './google';
import { recalculateDue } from './schedule';
import { seal } from './secrets';
import { domainCapacity } from './domains';

const LEASE_MS = 5 * 60000;
const blocked = (message: string) => Object.assign(new Error(message), { deliveryNotStarted: true });
export function recoverAbandonedAttempts(workspace: Workspace, now: number) {
  for (const attempt of Object.values(workspace.attempts)) if (attempt.status === 'dispatching') {
    attempt.status = 'unknown';
    const saved = workspace.campaigns[attempt.campaignId];
    if (saved) { saved.state.campaign.status = 'alert_paused'; saved.state.campaign.rootCauseHint = 'A delivery outcome is uncertain after interruption. Review it before retrying.'; }
    const job = workspace.healthJobs.find((job) => job.id === attempt.campaignId);
    if (job) { job.status = 'failed'; const mailbox = workspace.mailboxes.find((m) => m.id === job.mailboxId); if (mailbox) mailbox.health = { status: 'unhealthy', checkedAt: now, detail: 'Health probe delivery is uncertain; review before another test.' }; }
  }
}
function requireLease(workspace: Workspace, token: string) {
  if (workspace.lease?.token !== token || workspace.lease.until < Date.now()) throw new Error('Worker ownership expired. No automatic resend will be attempted.');
}
function refreshCampaign(saved: SavedCampaign, workspace: Workspace) {
  if (saved.state.simulationMode) return;
  saved.state.mailboxes = saved.state.mailboxes.map((m) => workspace.mailboxes.find((current) => current.id === m.id) || { ...m, status: 'paused' });
  saved.state.domains = saved.state.domains.map((d) => workspace.domains.find((current) => current.id === d.id) || { ...d, status: 'paused' });
}

export class BackgroundWorker {
  constructor(private store: WorkspaceStore, private simulationProvider?: MailProvider,
    private healthIO?: { provider: MailProvider; checker: SeedChecker }) {}
  async processOwner(owner: string) {
    const leaseToken = randomUUID(); const now = Date.now();
    const claimed = await this.store.transact(owner, (workspace) => {
      if (workspace.killSwitch || (workspace.lease && workspace.lease.until > now) || workspace.nextDueAt > now) return false;
      recoverAbandonedAttempts(workspace, now);
      workspace.lease = { token: leaseToken, until: now + LEASE_MS }; workspace.workerHeartbeat = now;
      workspace.nextDueAt = now + LEASE_MS;
      return true;
    });
    if (!claimed) return false;
    try {
      let workspace = await this.store.read(owner);
      const job = workspace.healthJobs.find((job) => ['queued', 'waiting'].includes(job.status) && job.dueAt <= now);
      if (job) await this.health(owner, leaseToken, workspace, job);
      else {
        const saved = Object.values(workspace.campaigns).filter((saved) => ['running', 'alert_paused'].includes(saved.state.campaign.status) && saved.nextDueAt <= now).sort((a, b) => a.nextDueAt - b.nextDueAt)[0];
        if (saved) await this.campaign(owner, leaseToken, workspace, saved);
      }
    } finally {
      await this.store.transact(owner, (workspace) => {
        if (workspace.lease?.token === leaseToken) { workspace.lease = undefined; workspace.workerHeartbeat = Date.now(); recalculateDue(workspace); }
      });
    }
    return true;
  }

  private transport(owner: string, lease: string, campaignId: string, provider: MailProvider, health = false): MailProvider {
    return { sendEmail: async (params: SendEmailParams) => {
      const attemptId = createHash('sha256').update(`${campaignId}:${params.recipientId || params.seedToken}`).digest('hex');
      const rfcMessageId = `<mailflow-${attemptId}@${params.fromEmail.split('@')[1]}>`;
      await this.store.transact(owner, (workspace) => {
        requireLease(workspace, lease);
        if (workspace.killSwitch) throw blocked('Emergency stop is active.');
        const saved = workspace.campaigns[campaignId];
        if (!health && (!saved || saved.state.campaign.status !== 'running')) throw blocked('Campaign is paused.');
        const simulation = saved?.state.simulationMode;
        const mailbox = simulation ? saved!.state.mailboxes.find((m) => m.email === params.fromEmail) : workspace.mailboxes.find((m) => m.email === params.fromEmail);
        if (!mailbox) throw blocked('Mailbox is not available.');
        const domain = simulation ? saved!.state.domains.find((d) => d.id === mailbox.domainId) : workspace.domains.find((d) => d.id === mailbox.domainId);
        if (!health && (mailbox.status !== 'active' || domain?.status === 'paused')) throw blocked('Mailbox or domain is paused.');
        if (!simulation && !health && (!('health' in mailbox) || (mailbox as { health?: { status: string } }).health?.status !== 'healthy'
          || !workspace.connections.some((c) => c.email === mailbox.email && c.role === 'sender' && !c.revoked))) throw blocked('Mailbox connection and health must be rechecked.');
        if (workspace.suppression[params.toEmail.toLowerCase()]) throw blocked('Recipient is suppressed.');
        if (workspace.attempts[attemptId]) throw blocked('This delivery already has a saved attempt.');
        const campaign = saved?.state.campaign || { sendingWindow: { start: '10:00', end: '18:00', timeZone: 'Asia/Kolkata' } };
        const date = sendingDate(campaign as never, Date.now());
        const used = mailbox.dailyResetDate === date ? mailbox.sentToday : 0;
        if (used >= Math.min(50, mailbox.dailyCap)) throw blocked('Mailbox daily capacity is exhausted.');
        if (!simulation && domain && 'dailyBudget' in domain) {
          const capacity = domainCapacity(workspace, mailbox.domainId, date);
          if (capacity.used >= capacity.limit) throw blocked('Domain daily capacity is exhausted.');
        }
        workspace.attempts[attemptId] = { id: attemptId, campaignId, recipientId: params.recipientId, mailboxId: mailbox.id, status: 'dispatching', startedAt: Date.now(), rfcMessageId, ...(params.seedToken ? { seedToken: params.seedToken, seedEmail: params.toEmail } : {}) };
        mailbox.dailyResetDate = date; mailbox.sentToday = used + 1; mailbox.totalSent++;
        const recipient = saved?.state.recipients.find((r) => r.id === params.recipientId);
        if (recipient) recipient.status = 'sending';
      });
      let outbound = { ...params, rfcMessageId };
      if (!health && process.env.NEXT_PUBLIC_APP_URL) {
        const token = await seal({ owner, email: params.toEmail.toLowerCase(), expires: Date.now() + 10 * 365 * 86400000 });
        const landing = new URL('/unsubscribe', process.env.NEXT_PUBLIC_APP_URL); landing.searchParams.set('token', token);
        const endpoint = new URL('/api/unsubscribe', process.env.NEXT_PUBLIC_APP_URL); endpoint.searchParams.set('token', token);
        outbound = { ...outbound, unsubscribeUrl: endpoint.href, body: params.body.replace(/\[Unsubscribe(?: Link)?\]/gi, landing.href) };
      }
      let sent;
      try {
        sent = await provider.sendEmail(outbound);
        if (!sent.success) throw new Error('Delivery was not confirmed.');
      } catch (error) {
        await this.store.transact(owner, (workspace) => {
          const attempt = workspace.attempts[attemptId];
          if (attempt?.status === 'dispatching') attempt.status = 'unknown';
        });
        throw error;
      }
      await this.store.transact(owner, (workspace) => {
        requireLease(workspace, lease);
        const attempt = workspace.attempts[attemptId]; attempt.status = 'accepted'; attempt.messageId = sent.messageId;
        const saved = workspace.campaigns[campaignId];
        const recipient = saved?.state.recipients.find((r) => r.id === params.recipientId);
        if (recipient) { recipient.status = 'sent'; recipient.sentAt = Date.now(); recipient.messageId = sent.messageId; }
        const mailbox = saved?.state.simulationMode ? saved.state.mailboxes.find((m) => m.id === attempt.mailboxId) : workspace.mailboxes.find((m) => m.id === attempt.mailboxId);
        // If the process ends before the engine commits, wait for signals on recovery.
        if (mailbox) {
          mailbox.nextSendAt = Date.now() + 120000; mailbox.signalCheckAt = Date.now() + 120000;
          if (params.seedToken) mailbox.pendingSeedProbes = [...(mailbox.pendingSeedProbes || []), { email: params.toEmail, token: params.seedToken }];
        }
      });
      return sent;
    } };
  }

  private async campaign(owner: string, lease: string, workspace: Workspace, saved: SavedCampaign) {
    const tickStarted = Date.now();
    refreshCampaign(saved, workspace);
    const initial = structuredClone(saved.state); const controlVersion = saved.controlVersion;
    const simulation = initial.simulationMode;
    const token = connectedTokenResolver(owner, this.store);
    const provider = simulation ? this.simulationProvider || new MockMailProvider() : new GmailMailProvider(token);
    const engine = new BlastEngine(this.transport(owner, lease, initial.campaign.id, provider), simulation ? new MockBounceSource() : new GmailBounceSource(token), simulation ? new MockSeedChecker() : new GmailSeedChecker(token), {
      seedEmails: workspace.connections.filter((c) => c.role === 'seed' && !c.revoked).map((c) => c.email),
      storage: {
        isEmailSuppressed: async (email) => Boolean((await this.store.read(owner)).suppression[email.toLowerCase()]),
        addSuppression: async (email, reason) => { await this.store.transact(owner, (workspace) => { workspace.suppression[email.toLowerCase()] = { reason, at: Date.now() }; }); },
        recordSeedResult: async () => {},
      },
    });
    const candidates = initial.mailboxes.filter((m) => {
      if (m.status !== 'active') return false;
      if (m.signalCheckAt) return m.signalCheckAt <= Date.now();
      if (initial.campaign.status !== 'running' || (m.nextSendAt || 0) > Date.now()) return false;
      if (!simulation && !inSendingWindow(initial.campaign, Date.now())) return false;
      const date = sendingDate(initial.campaign, Date.now());
      if (m.dailyResetDate === date && m.sentToday >= Math.min(50, m.dailyCap)) return false;
      const domain = workspace.domains.find((d) => d.id === m.domainId);
      if (!simulation && domain) { const capacity = domainCapacity(workspace, m.domainId, date); if (capacity.used >= capacity.limit) return false; }
      return initial.recipients.some((r) => r.mailboxId === m.id && r.status === 'pending');
    }).sort((a, b) => (a.signalCheckAt || a.nextSendAt || 0) - (b.signalCheckAt || b.nextSendAt || 0));
    const result = candidates.length ? await engine.processMailboxBatch(candidates[0].id, initial) : { updatedState: engine.reconcileState(initial) };
    await this.store.transact(owner, (workspace) => {
      requireLease(workspace, lease);
      const current = workspace.campaigns[initial.campaign.id];
      if (!current) throw new Error('Campaign no longer exists.');
      if (current.controlVersion !== controlVersion) {
        const latest = current.state;
        result.updatedState.campaign.status = latest.campaign.status === 'running' ? result.updatedState.campaign.status : latest.campaign.status;
        result.updatedState.recipients = result.updatedState.recipients.map((recipient) => {
          const before = initial.recipients.find((r) => r.id === recipient.id);
          const changed = latest.recipients.find((r) => r.id === recipient.id);
          return changed && recipient.status === before?.status ? changed : recipient;
        });
        result.updatedState.mailboxes = result.updatedState.mailboxes.map((mailbox) => {
          const controlled = latest.mailboxes.find((m) => m.id === mailbox.id);
          return controlled ? { ...mailbox, status: mailbox.healthFlaggedAt ? mailbox.status : controlled.status,
            recentSeedPlacements: controlled.healthFlaggedAt ? controlled.recentSeedPlacements : mailbox.recentSeedPlacements,
            healthFlaggedAt: mailbox.healthFlaggedAt || controlled.healthFlaggedAt,
            cooldownUntil: Math.max(mailbox.cooldownUntil || 0, controlled.cooldownUntil || 0) || undefined } : mailbox;
        });
        result.updatedState.domains = result.updatedState.domains.map((domain) => {
          const controlled = latest.domains.find((d) => d.id === domain.id);
          return controlled?.status === 'paused' ? controlled : domain;
        });
        const eventIds = new Set(latest.events.map((event) => event.id));
        result.updatedState.events = [...latest.events, ...result.updatedState.events.filter((event) => !eventIds.has(event.id))].slice(0, 500);
        result.updatedState = engine.reconcileState(result.updatedState);
      }
      for (const mailbox of result.updatedState.mailboxes) {
        const canonical = (simulation ? current.state.mailboxes : workspace.mailboxes).find((m) => m.id === mailbox.id);
        if (canonical) {
          mailbox.totalSent = Math.max(mailbox.totalSent, canonical.totalSent);
          if (mailbox.dailyResetDate === canonical.dailyResetDate) mailbox.sentToday = Math.max(mailbox.sentToday, canonical.sentToday);
        }
      }
      if (!simulation) {
        for (const mailbox of result.updatedState.mailboxes) {
          const canonical = workspace.mailboxes.find((m) => m.id === mailbox.id);
          if (!canonical) continue;
          const status = canonical.lastControlAt && canonical.lastControlAt > tickStarted ? canonical.status : mailbox.status;
          Object.assign(canonical, mailbox, { status });
          if (mailbox.lastSignalReceivedAt && mailbox.lastSignalReceivedAt !== initial.mailboxes.find((m) => m.id === mailbox.id)?.lastSignalReceivedAt && mailbox.status === 'active') canonical.health = { status: 'healthy', checkedAt: mailbox.lastSignalReceivedAt, detail: 'Batch signal checks completed.' };
        }
        for (const domain of result.updatedState.domains) {
          const canonical = workspace.domains.find((d) => d.id === domain.id);
          if (!canonical) continue;
          if ((canonical.lastControlAt || 0) > tickStarted) continue;
          if (domain.status === 'paused' && canonical.status !== 'paused') { canonical.pausedAt = Date.now(); canonical.cooldownUntil = Date.now() + 72 * 3600000; }
          canonical.status = domain.status; canonical.flaggedMailboxCount = domain.flaggedMailboxCount;
        }
      }
      current.state = result.updatedState;
    });
  }

  private async health(owner: string, lease: string, workspace: Workspace, job: HealthJob) {
    const mailbox = workspace.mailboxes.find((m) => m.id === job.mailboxId);
    if (!mailbox) throw new Error('Health mailbox was removed.');
    const resolver = connectedTokenResolver(owner, this.store);
    if (job.status === 'queued') {
      try {
        await this.transport(owner, lease, job.id, this.healthIO?.provider || new GmailMailProvider(resolver), true).sendEmail({ fromEmail: mailbox.email, fromName: mailbox.displayName,
          replyTo: mailbox.email, toEmail: job.seedEmail, subject: `SkillFlow health probe [${job.token}]`, body: `Owned seed inbox health test. Probe: ${job.token}`, seedToken: job.token, recipientId: job.token, campaignId: job.id });
        await this.store.transact(owner, (workspace) => { requireLease(workspace, lease); const current = workspace.healthJobs.find((item) => item.id === job.id)!; current.status = 'waiting'; current.dueAt = Date.now() + 120000; });
      } catch {
        await this.store.transact(owner, (workspace) => { const current = workspace.healthJobs.find((item) => item.id === job.id)!; current.status = 'failed'; const mailbox = workspace.mailboxes.find((m) => m.id === job.mailboxId)!; mailbox.health = { status: 'unhealthy', checkedAt: Date.now(), detail: 'Probe could not be confirmed. Review the connection and delivery log before retrying.' }; });
      }
      return;
    }
    try {
      const result = await (this.healthIO?.checker || new GmailSeedChecker(resolver)).checkSeedPlacement(job.seedEmail, job.id, mailbox.email, job.token);
      await this.store.transact(owner, (workspace) => {
        requireLease(workspace, lease);
        const current = workspace.healthJobs.find((item) => item.id === job.id)!; current.status = 'done';
        const mailbox = workspace.mailboxes.find((m) => m.id === job.mailboxId)!;
        mailbox.health = { status: result.placement === 'spam' ? 'unhealthy' : 'healthy', checkedAt: Date.now(), placement: result.placement, detail: `Owned seed probe: ${result.placement}.` };
        if (result.placement !== 'spam') mailbox.healthPassedAt = Date.now();
      });
    } catch {
      await this.store.transact(owner, (workspace) => {
        requireLease(workspace, lease);
        const current = workspace.healthJobs.find((item) => item.id === job.id)!; current.attempts++;
        if (current.attempts >= 5) { current.status = 'failed'; const mailbox = workspace.mailboxes.find((m) => m.id === job.mailboxId)!; mailbox.health = { status: 'unhealthy', checkedAt: Date.now(), detail: 'No matching seed result after retries. Sending remains blocked.' }; }
        else current.dueAt = Date.now() + 120000;
      });
    }
  }
}
