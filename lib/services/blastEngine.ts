import { BLAST_CONFIG } from '@/lib/config/blastConfig';
import type {
  Campaign, Recipient, BlastDomain, BlastMailbox, BlastEvent, MailProvider,
  BounceSource, SeedChecker, SeedPlacement,
} from '@/lib/types/blast';
import { getActiveMailProvider, getActiveBounceSource, getActiveSeedChecker } from './blastProviders';
import { blastStorage } from './blastStorage';

export interface EngineState {
  revision?: number;
  campaign: Campaign;
  recipients: Recipient[];
  domains: BlastDomain[];
  mailboxes: BlastMailbox[];
  events: BlastEvent[];
  seedIndex: number;
  simulationMode: boolean;
  simulationSpeedMultiplier: number;
  // Arrays survive the browser/worker JSON boundary; Sets do not.
  delayedSignalMailboxes: string[];
}

interface EngineOptions {
  now?: () => number;
  random?: () => number;
  storage?: Pick<typeof blastStorage, 'isEmailSuppressed' | 'addSuppression' | 'recordSeedResult'>;
}

export const mailboxCapacity = (mailbox: BlastMailbox) =>
  Math.max(0, Math.min(BLAST_CONFIG.HARD_MAX_MAILBOX_DAILY_CAP, mailbox.dailyCap) - mailbox.sentToday);

function localClock(now: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (key: string) => parts.find((part) => part.type === key)?.value || '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function inSendingWindow(campaign: Campaign, now: number): boolean {
  const parse = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
  const start = parse(campaign.sendingWindow.start);
  const end = parse(campaign.sendingWindow.end);
  const { minutes } = localClock(now, campaign.sendingWindow.timeZone || 'Asia/Kolkata');
  return Number.isFinite(start) && Number.isFinite(end) && start < end && minutes >= start && minutes < end;
}

export function sendingDate(campaign: Campaign, now: number): string {
  return localClock(now, campaign.sendingWindow.timeZone || 'Asia/Kolkata').date;
}

export class BlastEngine {
  private now: () => number;
  private random: () => number;
  private storage: NonNullable<EngineOptions['storage']>;

  constructor(
    private mailProvider: MailProvider = getActiveMailProvider(),
    private bounceSource: BounceSource = getActiveBounceSource(),
    private seedChecker: SeedChecker = getActiveSeedChecker(),
    options: EngineOptions = {},
  ) {
    this.now = options.now || Date.now;
    this.random = options.random || Math.random;
    this.storage = options.storage || blastStorage;
  }

  private event(state: EngineState, title: string, description: string, level: BlastEvent['level'] = 'info', mailbox?: BlastMailbox) {
    state.events.unshift({ id: `evt-${this.now()}-${this.random()}`, campaignId: state.campaign.id,
      timestamp: this.now(), title, description, level, ...(mailbox ? { mailboxId: mailbox.id, domainId: mailbox.domainId } : {}) });
  }

  private clone(state: EngineState): EngineState {
    return {
      ...state, campaign: { ...state.campaign }, recipients: state.recipients.map((r) => ({ ...r })),
      domains: state.domains.map((d) => ({ ...d })),
      mailboxes: state.mailboxes.map((m) => ({ ...m, recentSeedPlacements: [...m.recentSeedPlacements], pendingSeedProbes: [...(m.pendingSeedProbes || [])] })),
      events: [...state.events], delayedSignalMailboxes: [...(state.delayedSignalMailboxes || [])],
    };
  }

  computeScheduleETA(recipientCount: number, mailboxes: BlastMailbox[], sendingWindowHours = 8) {
    const active = mailboxes.filter((m) => m.status === 'active');
    const totalDailyCapacity = active.reduce((sum, m) => sum + mailboxCapacity(m), 0);
    const nextDayCapacity = active.reduce((sum, m) => sum + Math.min(m.dailyCap, 50), 0);
    const daysNeeded = recipientCount <= totalDailyCapacity ? 1
      : nextDayCapacity ? 1 + Math.ceil((recipientCount - totalDailyCapacity) / nextDayCapacity) : Infinity;
    return {
      totalDailyCapacity, daysNeeded,
      etaDescription: !totalDailyCapacity ? 'No active mailbox capacity available today.' : daysNeeded === 1
        ? `${recipientCount} emails: about ${Math.max(1, Math.ceil(recipientCount / totalDailyCapacity * sendingWindowHours))} hours today (estimate, including seed capacity).`
        : `${recipientCount} emails: at least ${daysNeeded} sending days; seed probes also use daily capacity.`,
      todayCapacities: active.map((m) => ({ mailboxId: m.id, cap: Math.min(m.dailyCap, 50), remaining: mailboxCapacity(m) })),
    };
  }

  distributeRecipients(recipients: Recipient[], mailboxes: BlastMailbox[]) {
    const active = mailboxes.filter((m) => m.status === 'active');
    let index = 0;
    const updatedRecipients = recipients.map((r) => r.status !== 'pending' || r.sentAt || !active.length
      ? { ...r } : { ...r, mailboxId: active[index++ % active.length].id });
    return { updatedRecipients, updatedMailboxes: mailboxes.map((m) => ({ ...m,
      assignedRecipientCount: updatedRecipients.filter((r) => r.status === 'pending' && r.mailboxId === m.id).length })) };
  }

  analyzeRootCause(mailboxes: BlastMailbox[]) {
    const flagged = mailboxes.filter((m) => m.healthFlaggedAt !== undefined);
    return flagged.length === 1 ? 'Isolated mailbox health failure.'
      : 'No healthy sending capacity remains. Review seed placement, bounce signals, and domain health.';
  }

  reallocateUnsentRecipients(recipients: Recipient[], mailboxes: BlastMailbox[], events: BlastEvent[], campaignId: string, domains?: BlastDomain[]) {
    const allowedDomain = (m: BlastMailbox) => !domains || domains.some((d) => d.id === m.domainId && d.status !== 'paused');
    const updatedMailboxes = mailboxes.map((m) => ({ ...m }));
    const blocked = new Set(updatedMailboxes.filter((m) => m.status === 'paused' || m.status === 'cooldown' || !allowedDomain(m)).map((m) => m.id));
    const orphaned = recipients.filter((r) => r.status === 'pending' && !r.sentAt && (!r.mailboxId || blocked.has(r.mailboxId)));
    const updatedEvents = [...events];
    const addEvent = (title: string, description: string, level: BlastEvent['level']) => {
      if (!updatedEvents.some((event) => event.title === title && event.description === description)) updatedEvents.unshift({
        id: `failover-${this.now()}-${this.random()}`, campaignId, timestamp: this.now(), title, description, level,
      });
    };
    // Reserve daily slots for work already assigned before moving any additional work.
    const reserved = (id: string) => recipients.filter((r) => r.status === 'pending' && !r.sentAt && r.mailboxId === id).length;
    const free = (m: BlastMailbox) => Math.max(0, mailboxCapacity(m) - reserved(m.id));
    const active = updatedMailboxes.filter((m) => m.status === 'active' && allowedDomain(m) && mailboxCapacity(m) > 0);
    let spare = updatedMailboxes.find((m) => m.status === 'spare' && allowedDomain(m) && mailboxCapacity(m) > 0 && (!m.cooldownUntil || m.cooldownUntil <= this.now()));
    if (orphaned.length && spare) {
      spare.status = 'active';
      active.unshift(spare);
      addEvent('Spare Mailbox Activated', `${spare.email} activated for pending recipients. Its own daily limit still applies.`, 'success');
    }
    const slots = new Map(active.map((m) => [m.id, free(m)]));
    let moved = 0;
    const updatedRecipients = recipients.map((r) => {
      if (r.status !== 'pending' || r.sentAt || (r.mailboxId && !blocked.has(r.mailboxId))) return { ...r };
      const target = active.find((m) => (slots.get(m.id) || 0) > 0);
      if (!target) return { ...r };
      slots.set(target.id, slots.get(target.id)! - 1);
      moved++;
      return { ...r, mailboxId: target.id, leaseExpiresAt: undefined, leaseWorkerId: undefined };
    });
    for (const m of updatedMailboxes) m.assignedRecipientCount = updatedRecipients.filter((r) => r.status === 'pending' && r.mailboxId === m.id).length;
    if (moved) addEvent('Auto-Reallocation Complete', `${moved} unsent recipients moved to healthy mailboxes. Sent and in-flight recipients were left unchanged.`, 'info');
    if (orphaned.length > moved) addEvent('Recipients Held Pending', `${orphaned.length - moved} recipients remain queued until healthy mailbox capacity is available.`, 'warn');
    const hasFreeCapacity = active.some((m) => mailboxCapacity(m) > 0);
    if (!hasFreeCapacity && orphaned.length) addEvent('No Healthy Mailbox Available', 'Sending stopped. No healthy mailbox or eligible spare has capacity.', 'error');
    return { updatedRecipients, updatedMailboxes, updatedEvents, hasFreeCapacity };
  }

  private counters(state: EngineState) {
    for (const m of state.mailboxes) m.assignedRecipientCount = state.recipients.filter((r) => r.status === 'pending' && r.mailboxId === m.id).length;
    const campaign = state.campaign;
    campaign.sentCount = state.recipients.filter((r) => r.status === 'sent').length;
    campaign.bouncedCount = state.recipients.filter((r) => r.status === 'bounced').length;
    campaign.skippedCount = state.recipients.filter((r) => r.status === 'skipped').length;
    campaign.pendingCount = state.recipients.filter((r) => r.status === 'pending' || r.status === 'sending').length;
    campaign.updatedAt = this.now();
    if (!campaign.pendingCount && !state.mailboxes.some((m) => m.status === 'active' && (m.signalCheckAt || m.pendingSeedProbes?.length)) && campaign.status === 'running') {
      campaign.status = 'completed';
      campaign.completedAt = this.now();
    }
    state.events = state.events.slice(0, 500);
  }

  private resetDay(state: EngineState) {
    const date = localClock(this.now(), state.campaign.sendingWindow.timeZone || 'Asia/Kolkata').date;
    for (const m of state.mailboxes) {
      if (m.dailyResetDate && m.dailyResetDate !== date) {
        if (m.status === 'active' && !m.backoffActive && !m.signalCheckAt && m.sentToday > 0 && state.campaign.enableRamp) {
          const percent = Math.max(10, Math.min(20, state.campaign.rampPercent || 15));
          m.dailyCap = Math.min(50, Math.floor(m.dailyCap * (1 + percent / 100)));
        }
        m.sentToday = 0;
      }
      m.dailyResetDate = date;
      m.dailyCap = Math.max(1, Math.min(50, m.dailyCap));
    }
  }

  private enforceRules(state: EngineState): EngineState {
    let needsFailover = false;
    for (const m of state.mailboxes) {
      const sent = m.totalSent - (m.healthSentBaseline || 0);
      const bounced = m.bouncesCount - (m.healthBounceBaseline || 0);
      m.bounceRate = sent > 0 ? Number((bounced / sent * 100).toFixed(2)) : 0;
      const spam = m.recentSeedPlacements.slice(-3).filter((p) => p === 'spam').length >= 2;
      const bounce = sent >= 50 && bounced / sent * 100 > 3;
      if (m.status === 'active' && (spam || bounce)) {
        m.status = 'paused';
        m.healthFlaggedAt = this.now();
        m.cooldownUntil = this.now() + BLAST_CONFIG.COOLDOWN_HOURS_DEFAULT * 3600000;
        m.batchSentCount = 0;
        m.nextSendAt = undefined;
        this.event(state, spam ? 'Mailbox Paused (Spam Placement)' : 'Mailbox Paused (High Bounce Rate)',
          `${m.email}: ${spam ? '2 of the last 3 seed results were spam' : `bounce rate ${m.bounceRate}% after ${sent} sends`}. Cooldown: 48 hours.`, 'warn', m);
        needsFailover = true;
      }
    }
    for (const domain of state.domains) {
      const members = state.mailboxes.filter((m) => m.domainId === domain.id);
      domain.flaggedMailboxCount = members.filter((m) => m.healthFlaggedAt !== undefined).length;
      if (domain.flaggedMailboxCount >= 2 && domain.status !== 'paused') {
        domain.status = 'paused';
        this.event(state, 'Domain Paused', `${domain.name}: two mailboxes flagged. All mailboxes on this domain are blocked.`, 'error');
      } else if (domain.flaggedMailboxCount && domain.status === 'active') domain.status = 'watch';
      if (domain.status === 'paused') {
        for (const m of members) if (m.status === 'active' || m.status === 'spare') m.status = 'paused';
        needsFailover = true;
      }
    }
    const blocked = new Set(state.mailboxes.filter((m) => m.status === 'paused' || m.status === 'cooldown').map((m) => m.id));
    needsFailover ||= state.recipients.some((r) => r.status === 'pending' && !r.sentAt && (!r.mailboxId || blocked.has(r.mailboxId)));
    if (needsFailover) {
      const result = this.reallocateUnsentRecipients(state.recipients, state.mailboxes, state.events, state.campaign.id, state.domains);
      state.recipients = result.updatedRecipients;
      state.mailboxes = result.updatedMailboxes;
      state.events = result.updatedEvents;
      if (!result.hasFreeCapacity && state.campaign.status === 'running' && state.recipients.some((r) => r.status === 'pending')) {
        state.campaign.status = 'alert_paused';
        state.campaign.rootCauseHint = this.analyzeRootCause(state.mailboxes);
      }
    }
    const active = state.mailboxes.filter((m) => m.status === 'active');
    if (active.length && active.filter((m) => state.delayedSignalMailboxes.includes(m.id)).length / active.length >= 0.5) {
      state.campaign.status = 'alert_paused';
      state.campaign.rootCauseHint = 'At least half of active mailboxes have delayed signals. Sending paused until checks recover.';
    }
    this.counters(state);
    return state;
  }

  resumeMailbox(mailboxId: string, original: EngineState): EngineState {
    const state = this.clone(original);
    const m = state.mailboxes.find((mailbox) => mailbox.id === mailboxId);
    if (!m || state.domains.find((d) => d.id === m.domainId)?.status === 'paused') return original;
    if (m.cooldownUntil && m.cooldownUntil > this.now()) return original;
    m.status = 'active';
    if (m.healthFlaggedAt !== undefined) {
      m.dailyCap = BLAST_CONFIG.RESUME_DAILY_CAP_INITIAL;
      m.healthSentBaseline = m.totalSent;
      m.healthBounceBaseline = m.bouncesCount;
      m.healthFlaggedAt = undefined;
      m.recentSeedPlacements = [];
      m.bounceRate = 0;
    }
    m.cooldownUntil = undefined;
    this.event(state, 'Mailbox Resumed', `${m.email} resumed at ${m.dailyCap}/day.`, 'info', m);
    return this.enforceRules(state);
  }

  private delay(seconds: number, state: EngineState) {
    return seconds * 1000 / (state.simulationMode ? Math.max(1, Math.min(120, state.simulationSpeedMultiplier || 1)) : 1);
  }

  /** One due operation per tick. Deadlines avoid multi-minute requests and sleeps. */
  async processMailboxBatch(mailboxId: string, original: EngineState) {
    let state = this.clone(original);
    this.resetDay(state);
    state = this.enforceRules(state);
    let sentThisBatch = 0;
    let bouncedThisBatch = 0;
    const result = () => { this.counters(state); return { updatedState: state, sentThisBatch, bouncedThisBatch }; };
    if (state.campaign.status !== 'running' && state.campaign.status !== 'alert_paused') return result();
    let mailbox = state.mailboxes.find((m) => m.id === mailboxId);
    if (!mailbox || mailbox.status !== 'active' || state.domains.find((d) => d.id === mailbox!.domainId)?.status === 'paused') return result();
    const now = this.now();
    if (mailbox.signalCheckAt) {
      if (now < mailbox.signalCheckAt) return result();
      try {
        const sourceId = state.simulationMode ? mailbox.id : mailbox.email;
        const bounces = await this.bounceSource.getBounces(sourceId);
        for (const bounce of bounces) {
          const recipient = state.recipients.find((r) => r.mailboxId === mailboxId && r.email.toLowerCase() === bounce.email.toLowerCase() && r.status === 'sent');
          if (!recipient) continue; // Ignore unrelated and already-processed notifications.
          mailbox.bouncesCount++;
          bouncedThisBatch++;
          recipient.status = 'bounced';
          recipient.bounceReason = bounce.reason;
          if (bounce.type === 'hard') await this.storage.addSuppression(bounce.email, bounce.reason);
          this.event(state, 'Bounce Detected', `${bounce.email}: ${bounce.reason}`, 'warn', mailbox);
        }
        const replies = await this.bounceSource.checkReplies?.(mailbox.email) || [];
        for (const reply of replies) {
          if (!state.recipients.some((r) => r.email.toLowerCase() === reply.email.toLowerCase())) continue;
          await this.storage.addSuppression(reply.email, reply.isOptOut ? 'Recipient requested STOP' : 'Recipient replied');
          for (const r of state.recipients) if (r.status === 'pending' && r.email.toLowerCase() === reply.email.toLowerCase()) {
            r.status = 'skipped'; r.skipReason = 'Recipient replied or opted out';
          }
        }
        for (const probe of [...(mailbox.pendingSeedProbes || [])]) {
          const seed = await this.seedChecker.checkSeedPlacement(probe.email, state.campaign.id, sourceId, probe.token);
          mailbox.recentSeedPlacements = [...mailbox.recentSeedPlacements, seed.placement].slice(-3);
          mailbox.pendingSeedProbes = mailbox.pendingSeedProbes!.filter((p) => p.token !== probe.token);
          await this.storage.recordSeedResult(seed);
          this.event(state, `Seed Placement: ${seed.placement.toUpperCase()}`, `${probe.email}: ${seed.placement}`, seed.placement === 'spam' ? 'warn' : 'info', mailbox);
        }
        mailbox.lastSignalReceivedAt = now;
        mailbox.backoffActive = false;
        state.delayedSignalMailboxes = state.delayedSignalMailboxes.filter((id) => id !== mailboxId);
        mailbox.signalCheckAt = undefined;
        mailbox.batchSentCount = 0;
        mailbox.batchTarget = undefined;
      } catch {
        mailbox.backoffActive = true;
        if (!state.delayedSignalMailboxes.includes(mailboxId)) state.delayedSignalMailboxes.push(mailboxId);
        mailbox.signalCheckAt = now + this.delay(BLAST_CONFIG.SIGNAL_EVALUATION_WAIT_SECONDS, state);
        this.event(state, 'Signal Check Delayed', `${mailbox.email}: signal lookup failed; no successful placement has been assumed.`, 'warn', mailbox);
      }
      state = this.enforceRules(state);
      return result();
    }
    if (state.campaign.status !== 'running' || !mailboxCapacity(mailbox) || (mailbox.nextSendAt || 0) > now) return result();
    if (!state.simulationMode && !inSendingWindow(state.campaign, now)) return result();
    const pending = state.recipients.find((r) => r.mailboxId === mailboxId && r.status === 'pending' && !r.sentAt);
    if (!pending) return result();
    const seeds = state.simulationMode ? BLAST_CONFIG.DEFAULT_SEEDS : BLAST_CONFIG.LIVE_SEEDS;
    const isSeed = (mailbox.recipientSendsSinceSeed || 0) >= BLAST_CONFIG.SEED_INTERVAL - 1;
    if (!state.simulationMode && (!seeds.length || !state.campaign.senderName.trim() || !state.campaign.businessAddress.trim() || !state.campaign.optOutText.trim())) {
      state.campaign.status = 'alert_paused';
      state.campaign.rootCauseHint = 'Live sending requires configured seed inboxes, sender name, business address, and opt-out text.';
      return result();
    }
    try {
      if (!isSeed && await this.storage.isEmailSuppressed(pending.email)) {
        pending.status = 'skipped'; pending.skipReason = 'Recipient is suppressed';
        return result();
      }
    } catch {
      state.campaign.status = 'alert_paused';
      state.campaign.rootCauseHint = 'Suppression lookup failed. Sending paused until the list can be checked.';
      return result();
    }
    const seedEmail = seeds[state.seedIndex % seeds.length];
    const seedToken = isSeed ? `seed-${state.campaign.id}-${mailbox.id}-${now}-${Math.floor(this.random() * 1e9)}` : undefined;
    const footer = `\n\n${state.campaign.senderName}\n${state.campaign.businessAddress}\n${state.campaign.optOutText}`;
    try {
      const sent = await this.mailProvider.sendEmail({
        fromEmail: mailbox.email, fromName: state.campaign.senderName || mailbox.displayName,
        replyTo: mailbox.email, toEmail: isSeed ? seedEmail : pending.email, toName: isSeed ? undefined : pending.name,
        subject: isSeed ? `${state.campaign.subject} [${seedToken}]` : state.campaign.subject,
        body: state.campaign.body + footer, campaignId: state.campaign.id,
        recipientId: isSeed ? seedToken : pending.id, seedToken,
      });
      if (!sent.success) throw new Error('Provider did not confirm delivery');
      mailbox.sentToday++;
      mailbox.totalSent++;
      mailbox.batchSentCount = (mailbox.batchSentCount || 0) + 1;
      if (isSeed) {
        mailbox.pendingSeedProbes!.push({ email: seedEmail, token: seedToken! });
        mailbox.recipientSendsSinceSeed = 0;
        state.seedIndex++;
      } else {
        pending.status = 'sent'; pending.sentAt = now; pending.messageId = sent.messageId;
        mailbox.recipientSendsSinceSeed = (mailbox.recipientSendsSinceSeed || 0) + 1;
        sentThisBatch = 1;
      }
      mailbox.batchTarget ||= mailbox.backoffActive ? 5 : 10 + Math.floor(this.random() * 6);
      const gap = (30 + Math.floor(this.random() * 91)) * (mailbox.backoffActive ? 2 : 1);
      mailbox.nextSendAt = now + this.delay(gap, state);
      if (mailbox.batchSentCount >= mailbox.batchTarget || !mailboxCapacity(mailbox) || !state.recipients.some((r) => r.status === 'pending' && r.mailboxId === mailboxId)) {
        mailbox.signalCheckAt = now + this.delay(120, state);
        this.event(state, 'Batch Waiting for Signals', `${mailbox.email}: ${mailbox.batchSentCount} messages sent; waiting 2 minutes before signal evaluation${state.simulationMode ? ' (accelerated simulation)' : ''}.`, 'info', mailbox);
      }
    } catch {
      // Do not automatically resend after an ambiguous transport failure.
      if (!isSeed) { pending.status = 'sending'; pending.skipReason = 'Delivery outcome unknown; review before retrying'; }
      state.campaign.status = 'alert_paused';
      state.campaign.rootCauseHint = 'Mail transport failed. Campaign paused for delivery review to avoid duplicate sends.';
      this.event(state, 'Sending Failed', state.campaign.rootCauseHint, 'error', mailbox);
    }
    state = this.enforceRules(state);
    return result();
  }

  injectSimulatedBounce(mailboxId: string, original: EngineState, recipientEmail?: string): EngineState {
    if (!original.simulationMode) return original;
    const state = this.clone(original);
    const mailbox = state.mailboxes.find((m) => m.id === mailboxId);
    const r = state.recipients.find((r) => r.mailboxId === mailboxId && r.status === 'sent' && (!recipientEmail || r.email === recipientEmail));
    if (!mailbox || !r) return original;
    r.status = 'bounced'; r.bounceReason = 'Simulated hard bounce'; mailbox.bouncesCount++;
    this.event(state, 'Simulation: Fake Bounce', `${r.email} bounced on ${mailbox.email}.`, 'warn', mailbox);
    return this.enforceRules(state);
  }

  injectSimulatedSpamPlacement(mailboxId: string, original: EngineState): EngineState {
    if (!original.simulationMode) return original;
    const state = this.clone(original);
    const mailbox = state.mailboxes.find((m) => m.id === mailboxId && m.status === 'active');
    if (!mailbox) return original;
    mailbox.recentSeedPlacements = [...mailbox.recentSeedPlacements, 'spam' as SeedPlacement].slice(-3);
    this.event(state, 'Simulation: Seed Placement SPAM', `Injected observed SPAM result for ${mailbox.email}.`, 'warn', mailbox);
    return this.enforceRules(state);
  }

  injectDelayedSignalEvent(mailboxId: string, original: EngineState): EngineState {
    if (!original.simulationMode) return original;
    const state = this.clone(original);
    const mailbox = state.mailboxes.find((m) => m.id === mailboxId && m.status === 'active');
    if (!mailbox) return original;
    if (!state.delayedSignalMailboxes.includes(mailboxId)) state.delayedSignalMailboxes.push(mailboxId);
    mailbox.backoffActive = true;
    mailbox.signalCheckAt = this.now() + this.delay(120, state);
    this.event(state, 'Simulation: Signal Delayed', `Signal delayed for ${mailbox.email}.`, 'warn', mailbox);
    return this.enforceRules(state);
  }
}

export const blastEngine = new BlastEngine();
