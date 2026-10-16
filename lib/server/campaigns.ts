import { randomUUID } from 'node:crypto';
import { BlastEngine, EngineState } from '../services/blastEngine';
import type { BlastDomain, BlastMailbox, Campaign, Recipient } from '../types/blast';
import { BLAST_CONFIG } from '../config/blastConfig';
import { launchIssues } from './domains';
import type { WorkspaceStore, Workspace } from './model';
import { recalculateDue } from './schedule';

function text(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\r\n]/.test(value) && label !== 'Message') throw new Error(`${label} is missing or too long.`);
  return value.trim();
}
export function createCampaign(workspace: Workspace, body: Record<string, unknown>): string {
  const simulationMode = body.providerMode !== 'live';
  if (!simulationMode && process.env.BLAST_PROVIDER_MODE !== 'live') throw new Error('Enable live mode on the server only after Google connections and health checks are ready.');
  const inputs = body.recipients;
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > BLAST_CONFIG.MAX_RECIPIENTS) throw new Error('Import 1–10,000 recipients.');
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (const value of inputs) {
    const email = typeof value?.email === 'string' ? value.email.trim().toLowerCase() : '';
    if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email) || email.length > 254) throw new Error('The recipient list contains an invalid address.');
    if (seen.has(email)) continue; seen.add(email);
    recipients.push({ id: randomUUID(), email, name: typeof value.name === 'string' ? value.name.slice(0, 100).replace(/[\r\n]/g, '') : undefined,
      status: workspace.suppression[email] ? 'skipped' : 'pending', ...(workspace.suppression[email] ? { skipReason: 'Previously suppressed' } : {}) });
  }
  const selected = Array.isArray(body.mailboxIds) ? body.mailboxIds.filter((id): id is string => typeof id === 'string') : [];
  let domains: BlastDomain[]; let mailboxes: BlastMailbox[];
  if (simulationMode) {
    domains = BLAST_CONFIG.DEFAULT_DOMAINS.map((d) => ({ ...d, flaggedMailboxCount: 0 }));
    mailboxes = BLAST_CONFIG.DEFAULT_MAILBOXES.map((m) => ({ ...m, sentToday: 0, totalSent: 0, bouncesCount: 0, bounceRate: 0, recentSeedPlacements: [], assignedRecipientCount: 0 }));
  } else {
    const issues = launchIssues(workspace, selected);
    if (issues.length) throw new Error(issues.join(' '));
    if (process.env.NODE_ENV === 'production' && !process.env.BLAST_TASKS_QUEUE) throw new Error('Configure the authenticated background queue before live launch.');
    // A mailbox cannot be driven by two campaigns at once; its health/timing window is shared.
    if (Object.values(workspace.campaigns).some((saved) => !saved.state.simulationMode && ['running', 'paused', 'alert_paused'].includes(saved.state.campaign.status))) throw new Error('Finish the existing live campaign before starting another. Mailbox quotas and health are shared.');
    mailboxes = workspace.mailboxes.filter((m) => selected.includes(m.id) || m.status === 'spare').map((m) => ({ ...m }));
    domains = workspace.domains.filter((d) => mailboxes.some((m) => m.domainId === d.id)).map((d) => ({ ...d }));
  }
  const id = randomUUID(); const now = Date.now();
  const window = body.sendingWindow as { start?: string; end?: string; timeZone?: string } | undefined;
  const start = window?.start || '10:00'; const end = window?.end || '18:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || start >= end) throw new Error('Enter a valid same-day sending window.');
  const campaign: Campaign = { id, name: text(body.name, 'Campaign name', 120), subject: text(body.subject, 'Subject', 200), body: text(body.body, 'Message', 100000),
    senderName: text(body.senderName, 'Sender name', 100), businessAddress: text(body.businessAddress, 'Business address', 500), optOutText: text(body.optOutText, 'Opt-out text', 500),
    sendingWindow: { start, end, timeZone: 'Asia/Kolkata' }, enableRamp: body.enableRamp === true, rampPercent: Math.max(10, Math.min(20, Number(body.rampPercent) || 15)),
    status: workspace.killSwitch ? 'paused' : 'running', totalRecipients: recipients.length, sentCount: 0, bouncedCount: 0,
    pendingCount: recipients.filter((r) => r.status === 'pending').length, skippedCount: recipients.filter((r) => r.status === 'skipped').length,
    createdAt: now, updatedAt: now, providerMode: simulationMode ? 'simulation' : 'live' };
  const allocation = new BlastEngine().distributeRecipients(recipients, mailboxes);
  workspace.campaigns[id] = { state: { campaign, recipients: allocation.updatedRecipients, mailboxes: allocation.updatedMailboxes, domains,
    events: [{ id: randomUUID(), campaignId: id, timestamp: now, level: 'info', title: 'Campaign Saved', description: 'Campaign is stored on the server. A background worker drives sending and health checks.' }],
    seedIndex: 0, simulationMode, simulationSpeedMultiplier: 60, delayedSignalMailboxes: [] }, controlVersion: 0, createdAt: now, nextDueAt: now };
  recalculateDue(workspace, now); return id;
}

export function campaignState(workspace: Workspace, id: string): EngineState {
  const saved = workspace.campaigns[id]; if (!saved) throw new Error('Campaign not found.');
  const state = structuredClone(saved.state);
  if (!state.simulationMode) { state.mailboxes = state.mailboxes.map((m) => workspace.mailboxes.find((record) => record.id === m.id) || m); state.domains = state.domains.map((d) => workspace.domains.find((record) => record.id === d.id) || d); }
  state.campaign.sentCount = state.recipients.filter((r) => r.status === 'sent').length;
  state.campaign.bouncedCount = state.recipients.filter((r) => r.status === 'bounced').length;
  state.campaign.pendingCount = state.recipients.filter((r) => ['pending', 'sending'].includes(r.status)).length;
  state.campaign.skippedCount = state.recipients.filter((r) => r.status === 'skipped').length;
  return state;
}

export function controlCampaign(workspace: Workspace, id: string, action: string, target?: string) {
  const saved = workspace.campaigns[id]; if (!saved) throw new Error('Campaign not found.');
  let state = campaignState(workspace, id); const engine = new BlastEngine();
  if (action === 'pause') state.campaign.status = 'paused';
  else if (action === 'resume') {
    if (workspace.killSwitch) throw new Error('Release the emergency stop first.');
    if (state.recipients.some((r) => r.status === 'sending') || Object.values(workspace.attempts).some((attempt) => attempt.campaignId === id && attempt.status === 'unknown')) throw new Error('An uncertain send needs review before this campaign can resume.');
    if (!state.simulationMode && !state.mailboxes.some((m) => m.status === 'active' && workspace.mailboxes.some((record) => record.id === m.id && record.health?.status === 'healthy')
      && state.domains.some((domain) => domain.id === m.domainId && domain.status !== 'paused'))) throw new Error('A healthy connected mailbox is required to resume.');
    state.campaign.status = 'running';
  } else if (action === 'mailbox') {
    const mailbox = state.mailboxes.find((m) => m.id === target); if (!mailbox) throw new Error('Mailbox not found.');
    if (mailbox.status === 'active') mailbox.status = 'paused';
    else {
      const resumed = engine.resumeMailbox(mailbox.id, state);
      if (resumed.mailboxes.find((m) => m.id === target)?.status !== 'active') throw new Error('Cooldown and a fresh healthy recovery test are required before resume.');
      state = resumed;
    }
    const reallocation = engine.reallocateUnsentRecipients(state.recipients, state.mailboxes, state.events, id, state.domains);
    state.recipients = reallocation.updatedRecipients; state.mailboxes = reallocation.updatedMailboxes; state.events = reallocation.updatedEvents;
  } else if (action === 'domain') {
    const domain = state.domains.find((d) => d.id === target); if (!domain) throw new Error('Domain not found.');
    if (domain.status === 'paused') {
      if ((domain.cooldownUntil || 0) > Date.now()) throw new Error('The domain cooldown is still active.');
      const flagged = state.mailboxes.filter((m) => m.domainId === target && m.healthFlaggedAt);
      if (!state.simulationMode && flagged.some((m) => (m.healthPassedAt || 0) <= (domain.cooldownUntil || domain.pausedAt || 0))) throw new Error('Each flagged mailbox must pass a new health check after the domain cooldown.');
      domain.status = 'active'; domain.flaggedMailboxCount = 0; domain.cooldownUntil = undefined;
      for (const m of flagged) { m.healthFlaggedAt = undefined; m.healthSentBaseline = m.totalSent; m.healthBounceBaseline = m.bouncesCount; m.recentSeedPlacements = []; m.dailyCap = 8; }
    } else {
      domain.status = 'paused'; domain.pausedAt = Date.now(); domain.cooldownUntil = Date.now() + 72 * 3600000;
      for (const m of state.mailboxes) if (m.domainId === target) m.status = 'paused';
      const reallocation = engine.reallocateUnsentRecipients(state.recipients, state.mailboxes, state.events, id, state.domains);
      state.recipients = reallocation.updatedRecipients; state.mailboxes = reallocation.updatedMailboxes; state.events = reallocation.updatedEvents;
    }
  } else if (state.simulationMode && target && action === 'inject-spam') state = engine.injectSimulatedSpamPlacement(target, state);
  else if (state.simulationMode && target && action === 'inject-bounce') state = engine.injectSimulatedBounce(target, state);
  else if (state.simulationMode && target && action === 'inject-delay') state = engine.injectDelayedSignalEvent(target, state);
  else throw new Error('Invalid campaign action.');
  if (!state.simulationMode && ['mailbox', 'domain'].includes(action)) {
    for (const m of state.mailboxes) { const canonical = workspace.mailboxes.find((record) => record.id === m.id); if (canonical) Object.assign(canonical, m, { lastControlAt: Date.now() }); }
    for (const d of state.domains) { const canonical = workspace.domains.find((record) => record.id === d.id); if (canonical) Object.assign(canonical, d, action === 'domain' && d.id === target ? { lastControlAt: Date.now() } : {}); }
  }
  state.campaign.updatedAt = Date.now(); saved.state = state; saved.controlVersion++; recalculateDue(workspace);
}

export async function saveNewCampaign(store: WorkspaceStore, owner: string, body: Record<string, unknown>) {
  return store.transact(owner, (workspace) => createCampaign(workspace, body));
}
