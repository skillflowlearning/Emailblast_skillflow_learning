/**
 * Email Blast Engine
 * Handles batching, parallel mailbox sending, signal evaluation,
 * auto-rules enforcement, failover reallocation, and simulation hooks.
 */

import { BLAST_CONFIG } from '@/lib/config/blastConfig';
import {
  Campaign,
  Recipient,
  BlastDomain,
  BlastMailbox,
  BlastEvent,
  SeedPlacement,
  MailProvider,
  BounceSource,
  SeedChecker,
} from '@/lib/types/blast';
import {
  defaultMailProvider,
  defaultBounceSource,
  defaultSeedChecker,
  MockBounceSource,
  MockSeedChecker,
  getActiveMailProvider,
  getActiveBounceSource,
  getActiveSeedChecker,
} from '@/lib/services/blastProviders';
import { blastStorage } from '@/lib/services/blastStorage';
import { isSuppressed } from '@/lib/services/suppression';

export interface EngineState {
  campaign: Campaign;
  recipients: Recipient[];
  domains: BlastDomain[];
  mailboxes: BlastMailbox[];
  events: BlastEvent[];
  seedIndex: number;
  simulationMode: boolean;
  simulationSpeedMultiplier: number;
  delayedSignalMailboxes: Set<string>;
}

export class BlastEngine {
  private mailProvider: MailProvider;
  private bounceSource: BounceSource;
  private seedChecker: SeedChecker;

  constructor(
    mailProvider?: MailProvider,
    bounceSource?: BounceSource,
    seedChecker?: SeedChecker
  ) {
    this.mailProvider = mailProvider || getActiveMailProvider();
    this.bounceSource = bounceSource || getActiveBounceSource();
    this.seedChecker = seedChecker || getActiveSeedChecker();
  }

  // ── ETA & Capacity Calculations ──────────────────────────────────────────
  /**
   * Computes remaining daily capacity and multi-day ETA string
   */
  computeScheduleETA(
    recipientCount: number,
    mailboxes: BlastMailbox[],
    sendingWindowHours: number = 8
  ): {
    totalDailyCapacity: number;
    daysNeeded: number;
    etaDescription: string;
    todayCapacities: { mailboxId: string; cap: number; remaining: number }[];
  } {
    const activeMailboxes = mailboxes.filter((m) => m.status === 'active');
    const totalDailyCapacity = activeMailboxes.reduce(
      (sum, m) => sum + Math.max(0, m.dailyCap - m.sentToday),
      0
    );

    if (totalDailyCapacity <= 0) {
      return {
        totalDailyCapacity: 0,
        daysNeeded: Infinity,
        etaDescription: 'No active mailbox capacity available today.',
        todayCapacities: [],
      };
    }

    const todayCapacities = activeMailboxes.map((m) => ({
      mailboxId: m.id,
      cap: m.dailyCap,
      remaining: Math.max(0, m.dailyCap - m.sentToday),
    }));

    if (recipientCount <= totalDailyCapacity) {
      // Sends today within window
      const fractionOfDay = recipientCount / totalDailyCapacity;
      const hours = Math.max(1, Math.round(fractionOfDay * sendingWindowHours));
      return {
        totalDailyCapacity,
        daysNeeded: 1,
        etaDescription: `${recipientCount} emails: about ${hours} hour${hours === 1 ? '' : 's'} today.`,
        todayCapacities,
      };
    }

    const daysNeeded = Math.ceil(recipientCount / (activeMailboxes.reduce((s, m) => s + m.dailyCap, 0) || 1));
    return {
      totalDailyCapacity,
      daysNeeded,
      etaDescription: `${recipientCount} emails: about ${daysNeeded} days (exceeds single-day capacity of ${totalDailyCapacity}).`,
      todayCapacities,
    };
  }

  // ── Recipient Initial Allocation ─────────────────────────────────────────
  /**
   * Splits recipients equally across active mailboxes respecting caps.
   */
  distributeRecipients(
    recipients: Recipient[],
    mailboxes: BlastMailbox[]
  ): { updatedRecipients: Recipient[]; updatedMailboxes: BlastMailbox[] } {
    const active = mailboxes.filter((m) => m.status === 'active');
    if (active.length === 0) return { updatedRecipients: recipients, updatedMailboxes: mailboxes };

    const allocationCount: Record<string, number> = {};
    active.forEach((m) => (allocationCount[m.id] = 0));

    let activeIdx = 0;
    const updatedRecipients = recipients.map((r) => {
      if (r.status !== 'pending' && r.mailboxId) return r;

      const targetMailbox = active[activeIdx % active.length];
      activeIdx++;
      allocationCount[targetMailbox.id] = (allocationCount[targetMailbox.id] || 0) + 1;

      return {
        ...r,
        mailboxId: targetMailbox.id,
        status: 'pending' as const,
      };
    });

    const updatedMailboxes = mailboxes.map((m) => ({
      ...m,
      assignedRecipientCount: allocationCount[m.id] || 0,
    }));

    return { updatedRecipients, updatedMailboxes };
  }

  // ── Auto Rules & Root Cause Analysis ─────────────────────────────────────
  /**
   * Evaluates root cause hint based on failure patterns across mailboxes
   */
  analyzeRootCause(mailboxes: BlastMailbox[]): string {
    const paused = mailboxes.filter((m) => m.status === 'paused' || m.status === 'cooldown');
    const total = mailboxes.filter((m) => m.status !== 'spare').length;

    if (paused.length === 0) return 'All mailboxes healthy';
    if (paused.length === 1) {
      return 'Mailbox problem: isolated to this specific mailbox sender reputation or auth config.';
    }
    if (paused.length >= total) {
      return 'List or domain problem: high-risk recipient list, spam trap hit, or root domain blacklist.';
    }
    return 'Content problem: same message copy/links triggering spam filters across multiple mailboxes.';
  }

  // ── Auto Reallocation on Mailbox/Domain Pause ─────────────────────────────
  /**
   * Moves ONLY unsent recipients from paused/cooldown mailboxes to healthy mailboxes
   * with remaining capacity. Never resends to anyone already sent!
   */
  reallocateUnsentRecipients(
    recipients: Recipient[],
    mailboxes: BlastMailbox[],
    events: BlastEvent[],
    campaignId: string
  ): {
    updatedRecipients: Recipient[];
    updatedMailboxes: BlastMailbox[];
    updatedEvents: BlastEvent[];
    hasFreeCapacity: boolean;
  } {
    const healthyMailboxes = mailboxes.filter(
      (m) => m.status === 'active' && m.dailyCap - m.sentToday > 0
    );

    const pausedMailboxIds = new Set(
      mailboxes.filter((m) => m.status === 'paused' || m.status === 'cooldown').map((m) => m.id)
    );

    const orphanedRecipients = recipients.filter(
      (r) => r.status === 'pending' && r.mailboxId && pausedMailboxIds.has(r.mailboxId)
    );

    if (orphanedRecipients.length === 0) {
      return {
        updatedRecipients: recipients,
        updatedMailboxes: mailboxes,
        updatedEvents: events,
        hasFreeCapacity: healthyMailboxes.length > 0,
      };
    }

    if (healthyMailboxes.length === 0) {
      // No healthy mailbox with free capacity: stop sending, keep pending, alert
      const alertEvent: BlastEvent = {
        id: `evt-${Date.now()}-${Math.random()}`,
        campaignId,
        timestamp: Date.now(),
        level: 'error',
        title: 'No Healthy Mailbox Available',
        description: `${orphanedRecipients.length} unsent emails held as pending. All healthy mailbox capacities exhausted.`,
        rootCauseHint: 'Capacity depleted across all active mailboxes.',
      };

      return {
        updatedRecipients: recipients,
        updatedMailboxes: mailboxes,
        updatedEvents: [alertEvent, ...events],
        hasFreeCapacity: false,
      };
    }

    // Reallocate evenly across healthy mailboxes
    let healthyIdx = 0;
    const reallocatedRecipients = recipients.map((r) => {
      if (r.status === 'pending' && r.mailboxId && pausedMailboxIds.has(r.mailboxId)) {
        const target = healthyMailboxes[healthyIdx % healthyMailboxes.length];
        healthyIdx++;
        return {
          ...r,
          mailboxId: target.id,
        };
      }
      return r;
    });

    // Recompute assignedRecipientCount
    const countMap: Record<string, number> = {};
    reallocatedRecipients.forEach((r) => {
      if (r.status === 'pending' && r.mailboxId) {
        countMap[r.mailboxId] = (countMap[r.mailboxId] || 0) + 1;
      }
    });

    const updatedMailboxes = mailboxes.map((m) => ({
      ...m,
      assignedRecipientCount: countMap[m.id] || 0,
    }));

    const moveEvent: BlastEvent = {
      id: `evt-${Date.now()}-${Math.random()}`,
      campaignId,
      timestamp: Date.now(),
      level: 'info',
      title: 'Auto-Reallocation Complete',
      description: `Moved ${orphanedRecipients.length} unsent emails to ${healthyMailboxes.length} healthy mailbox(es). Already sent emails remain untouched.`,
      rootCauseHint: 'Auto-reallocation safeguard active.',
    };

    return {
      updatedRecipients: reallocatedRecipients,
      updatedMailboxes,
      updatedEvents: [moveEvent, ...events],
      hasFreeCapacity: true,
    };
  }

  // ── Batch Processing Step (Single Mailbox Tick) ──────────────────────────
  /**
   * Executes one batch cycle for an active mailbox:
   * 1. Checks suppression list
   * 2. Sends batch of 10-15 (or 5 if backoff) with gap
   * 3. Seed check every ~11th email
   * 4. Evaluates bounces & seed signals
   * 5. Enforces auto-rules (bounce >3%, spam 2-of-3, domain failure)
   */
  async processMailboxBatch(
    mailboxId: string,
    state: EngineState
  ): Promise<{
    updatedState: EngineState;
    sentThisBatch: number;
    bouncedThisBatch: number;
  }> {
    const { campaign, domains, mailboxes, recipients, events } = state;
    const mailbox = mailboxes.find((m) => m.id === mailboxId);
    if (!mailbox || mailbox.status !== 'active') {
      return { updatedState: state, sentThisBatch: 0, bouncedThisBatch: 0 };
    }

    const domain = domains.find((d) => d.id === mailbox.domainId);
    if (!domain || domain.status === 'paused') {
      return { updatedState: state, sentThisBatch: 0, bouncedThisBatch: 0 };
    }

    // Daily cap enforcement
    const remainingCap = Math.max(0, mailbox.dailyCap - mailbox.sentToday);
    if (remainingCap <= 0) {
      return { updatedState: state, sentThisBatch: 0, bouncedThisBatch: 0 };
    }

    // Determine batch size (Backoff safeguard if signals are delayed)
    const isBackoff = Boolean(mailbox.backoffActive || state.delayedSignalMailboxes.has(mailbox.id));
    const rawBatchSize = isBackoff
      ? BLAST_CONFIG.BACKOFF_BATCH_SIZE
      : Math.floor(
          Math.random() * (BLAST_CONFIG.BATCH_SIZE_MAX - BLAST_CONFIG.BATCH_SIZE_MIN + 1)
        ) + BLAST_CONFIG.BATCH_SIZE_MIN;

    const batchSize = Math.min(rawBatchSize, remainingCap);

    // Get pending recipients for this mailbox
    const pendingForMailbox = recipients.filter(
      (r) => r.mailboxId === mailbox.id && r.status === 'pending'
    );

    if (pendingForMailbox.length === 0) {
      return { updatedState: state, sentThisBatch: 0, bouncedThisBatch: 0 };
    }

    const currentBatchRecipients = pendingForMailbox.slice(0, batchSize);

    // Track state modifications
    const updatedRecipients = [...recipients];
    let newEvents = [...events];
    let sentCount = 0;
    let bouncedCount = 0;
    let newSeedIndex = state.seedIndex;

    // Send emails in batch with gap
    for (const r of currentBatchRecipients) {
      const idx = updatedRecipients.findIndex((rec) => rec.id === r.id);
      if (idx === -1) continue;

      // 1. Suppression check before send
      const suppressedLocally = await isSuppressed(r.email);
      const suppressedFirestore = await blastStorage.isEmailSuppressed(r.email);

      if (suppressedLocally || suppressedFirestore) {
        updatedRecipients[idx] = {
          ...r,
          status: 'skipped',
          skipReason: 'Present on suppression list (unsubscribed or prior bounce)',
        };
        continue;
      }

      // 2. Mock send with List-Unsubscribe header
      const sendResult = await this.mailProvider.sendEmail({
        fromEmail: mailbox.email,
        fromName: campaign.senderName || mailbox.displayName,
        toEmail: r.email,
        toName: r.name,
        subject: campaign.subject,
        body: campaign.body,
      });

      if (sendResult.success) {
        updatedRecipients[idx] = {
          ...r,
          status: 'sent',
          sentAt: Date.now(),
        };
        sentCount++;
      }

      // 3. Seed check every ~11th email
      const totalMailboxSent = mailbox.totalSent + sentCount;
      if (totalMailboxSent % BLAST_CONFIG.SEED_INTERVAL === 0) {
        const seedAddresses = BLAST_CONFIG.DEFAULT_SEEDS;
        const targetSeed = seedAddresses[newSeedIndex % seedAddresses.length];
        newSeedIndex++;

        const seedResult = await this.seedChecker.checkSeedPlacement(
          targetSeed,
          campaign.id,
          mailbox.id
        );

        await blastStorage.recordSeedResult(seedResult);

        // Update recent seed placements
        const currentPlacements = [...mailbox.recentSeedPlacements, seedResult.placement].slice(
          -BLAST_CONFIG.SEED_SPAM_CHECK_WINDOW
        );

        mailbox.recentSeedPlacements = currentPlacements;

        newEvents.unshift({
          id: `seed-${Date.now()}-${Math.random()}`,
          campaignId: campaign.id,
          timestamp: Date.now(),
          level: seedResult.placement === 'spam' ? 'warn' : 'info',
          title: `Seed Placement: ${seedResult.placement.toUpperCase()}`,
          description: `Seed address ${targetSeed} tested via ${mailbox.displayName}: placed in ${seedResult.placement} (Promotions is NOT spam).`,
          mailboxId: mailbox.id,
          domainId: mailbox.domainId,
        });
      }
    }

    // 4. Evaluate late or current bounce signals
    const bounces = await this.bounceSource.getBounces(mailbox.id);
    if (bounces.length > 0) {
      for (const b of bounces) {
        const isSoft = b.type === 'soft';
        const rIdx = updatedRecipients.findIndex((r) => r.email === b.email);
        const currentRecipient = rIdx !== -1 ? updatedRecipients[rIdx] : null;
        const softTries = (currentRecipient?.softBounceCount || 0) + 1;

        if (isSoft && softTries <= BLAST_CONFIG.MAX_SOFT_BOUNCE_RETRIES) {
          // Soft bounce: retry later at most twice
          if (rIdx !== -1) {
            updatedRecipients[rIdx] = {
              ...updatedRecipients[rIdx],
              status: 'pending',
              softBounceCount: softTries,
              bounceReason: `Soft Bounce (${b.statusCode || '4.x.x'}): ${b.reason} (Attempt ${softTries}/${BLAST_CONFIG.MAX_SOFT_BOUNCE_RETRIES})`,
            };
          }

          newEvents.unshift({
            id: `soft-bounce-${Date.now()}-${Math.random()}`,
            campaignId: campaign.id,
            timestamp: Date.now(),
            level: 'warn',
            title: 'Soft Bounce (Scheduled for Retry)',
            description: `${b.email} soft-bounced on ${mailbox.displayName}. Retry ${softTries}/${BLAST_CONFIG.MAX_SOFT_BOUNCE_RETRIES} will be attempted later.`,
            mailboxId: mailbox.id,
            domainId: mailbox.domainId,
          });
        } else {
          // Hard bounce (5.x.x) or exhausted soft bounce retries
          bouncedCount++;
          await blastStorage.addSuppression(b.email, b.reason);

          if (rIdx !== -1) {
            updatedRecipients[rIdx] = {
              ...updatedRecipients[rIdx],
              status: 'bounced',
              bounceReason: b.reason,
            };
          }

          newEvents.unshift({
            id: `bounce-${Date.now()}-${Math.random()}`,
            campaignId: campaign.id,
            timestamp: Date.now(),
            level: 'error',
            title: isSoft ? 'Soft Bounce Limit Exceeded' : 'Hard Bounce Detected',
            description: `Recipient ${b.email} bounced on ${mailbox.displayName}: ${b.reason}. Address added to suppression list.`,
            mailboxId: mailbox.id,
            domainId: mailbox.domainId,
          });
        }
      }
    }

    // 5. Update Mailbox metrics
    mailbox.sentToday += sentCount;
    mailbox.totalSent += sentCount;
    mailbox.bouncesCount += bouncedCount;
    mailbox.bounceRate =
      mailbox.totalSent > 0
        ? parseFloat(((mailbox.bouncesCount / mailbox.totalSent) * 100).toFixed(2))
        : 0;
    mailbox.lastSignalReceivedAt = Date.now();

    // 6. AUTO-RULES EVALUATION
    let mailboxPaused = false;
    let pauseReason = '';

    // Rule A: Seed lands in spam 2 of last 3 -> pause mailbox, domain 'watch'
    const recentSpams = mailbox.recentSeedPlacements.filter((p) => p === 'spam').length;
    if (recentSpams >= BLAST_CONFIG.SEED_SPAM_FAIL_COUNT) {
      mailboxPaused = true;
      pauseReason = `Seed landed in spam ${recentSpams} of last ${BLAST_CONFIG.SEED_SPAM_CHECK_WINDOW} tests.`;
      mailbox.status = 'paused';
      mailbox.cooldownUntil = Date.now() + BLAST_CONFIG.COOLDOWN_HOURS_DEFAULT * 3600 * 1000;

      // Mark domain as "watch"
      domain.status = 'watch';
      domain.flaggedMailboxCount = (domain.flaggedMailboxCount || 0) + 1;

      newEvents.unshift({
        id: `rule-seed-${Date.now()}-${Math.random()}`,
        campaignId: campaign.id,
        timestamp: Date.now(),
        level: 'warn',
        title: 'Mailbox Paused (Spam Placement)',
        description: `${mailbox.displayName} paused: ${pauseReason} Domain ${domain.name} marked on WATCH. Cooldown: ${BLAST_CONFIG.COOLDOWN_HOURS_DEFAULT}h.`,
        mailboxId: mailbox.id,
        domainId: domain.id,
        rootCauseHint: 'Mailbox problem: isolated spam placement on this sender.',
      });
    }

    // Rule B: Bounce rate above 3% once at least 50 emails sent -> pause mailbox
    if (
      mailbox.totalSent >= BLAST_CONFIG.BOUNCE_RATE_MIN_SENT_EMAILS &&
      mailbox.bounceRate > BLAST_CONFIG.BOUNCE_RATE_THRESHOLD_PERCENT
    ) {
      mailboxPaused = true;
      pauseReason = `Bounce rate exceeded 3% (${mailbox.bounceRate}% across ${mailbox.totalSent} sends).`;
      mailbox.status = 'paused';
      mailbox.cooldownUntil = Date.now() + BLAST_CONFIG.COOLDOWN_HOURS_DEFAULT * 3600 * 1000;

      newEvents.unshift({
        id: `rule-bounce-${Date.now()}-${Math.random()}`,
        campaignId: campaign.id,
        timestamp: Date.now(),
        level: 'error',
        title: 'Mailbox Paused (High Bounce Rate)',
        description: `${mailbox.displayName} paused: ${pauseReason} Cooldown: ${BLAST_CONFIG.COOLDOWN_HOURS_DEFAULT}h.`,
        mailboxId: mailbox.id,
        domainId: domain.id,
        rootCauseHint: 'Recipient list quality issue or invalid contact addresses.',
      });
    }

    // Rule C: 2 or more mailboxes flagged on one domain -> pause that whole domain
    const flaggedOnDomain = mailboxes.filter(
      (m) => m.domainId === domain.id && (m.status === 'paused' || m.status === 'cooldown')
    ).length;

    if (flaggedOnDomain >= BLAST_CONFIG.DOMAIN_FLAGGED_MAILBOXES_LIMIT) {
      domain.status = 'paused';
      newEvents.unshift({
        id: `rule-domain-${Date.now()}-${Math.random()}`,
        campaignId: campaign.id,
        timestamp: Date.now(),
        level: 'error',
        title: 'Domain Paused',
        description: `Domain ${domain.name} automatically paused: ${flaggedOnDomain} mailboxes flagged.`,
        domainId: domain.id,
        rootCauseHint: 'Domain reputation block: multiple mailboxes compromised.',
      });
    }

    // Rule D: If mailbox or domain paused, execute auto-reallocation of unsent emails
    let finalRecipients = updatedRecipients;
    let finalMailboxes = mailboxes.map((m) => (m.id === mailbox.id ? mailbox : m));
    let finalEvents = newEvents;

    if (mailboxPaused || domain.status === 'paused') {
      const realloc = this.reallocateUnsentRecipients(
        finalRecipients,
        finalMailboxes,
        finalEvents,
        campaign.id
      );
      finalRecipients = realloc.updatedRecipients;
      finalMailboxes = realloc.updatedMailboxes;
      finalEvents = realloc.updatedEvents;

      // Rule E: Check campaign-level root cause
      const allPaused = finalMailboxes
        .filter((m) => m.status !== 'spare')
        .every((m) => m.status === 'paused' || m.status === 'cooldown');

      if (allPaused) {
        campaign.status = 'alert_paused';
        campaign.rootCauseHint = this.analyzeRootCause(finalMailboxes);
        finalEvents.unshift({
          id: `rule-camp-pause-${Date.now()}-${Math.random()}`,
          campaignId: campaign.id,
          timestamp: Date.now(),
          level: 'error',
          title: 'Entire Campaign Paused',
          description: 'All sending mailboxes flagged or paused. Sending halted to protect domain reputation.',
          rootCauseHint: campaign.rootCauseHint,
        });
      }
    }

    // Update campaign counters
    const newSentCount = finalRecipients.filter((r) => r.status === 'sent').length;
    const newBouncedCount = finalRecipients.filter((r) => r.status === 'bounced').length;
    const newPendingCount = finalRecipients.filter((r) => r.status === 'pending').length;
    const newSkippedCount = finalRecipients.filter((r) => r.status === 'skipped').length;

    const updatedCampaign: Campaign = {
      ...campaign,
      sentCount: newSentCount,
      bouncedCount: newBouncedCount,
      pendingCount: newPendingCount,
      skippedCount: newSkippedCount,
      status: newPendingCount === 0 && campaign.status === 'running' ? 'completed' : campaign.status,
      updatedAt: Date.now(),
      completedAt: newPendingCount === 0 ? Date.now() : undefined,
    };

    return {
      updatedState: {
        ...state,
        campaign: updatedCampaign,
        domains: domains.map((d) => (d.id === domain.id ? domain : d)),
        mailboxes: finalMailboxes,
        recipients: finalRecipients,
        events: finalEvents,
        seedIndex: newSeedIndex,
      },
      sentThisBatch: sentCount,
      bouncedThisBatch: bouncedCount,
    };
  }

  // ── Simulation Helpers ───────────────────────────────────────────────────
  /**
   * Injects a fake bounce event for a specific mailbox to test auto-rules
   */
  injectSimulatedBounce(
    mailboxId: string,
    state: EngineState,
    recipientEmail?: string
  ): EngineState {
    const mailbox = state.mailboxes.find((m) => m.id === mailboxId);
    if (!mailbox) return state;

    const email = recipientEmail || `bounced-user-${Math.floor(Math.random() * 9000 + 1000)}@invalid-domain.xyz`;
    (this.bounceSource as MockBounceSource).injectBounce({
      email,
      mailboxId,
      domainId: mailbox.domainId,
      timestamp: Date.now(),
      type: 'hard',
      reason: '550 5.1.1 User unknown / Host not found (Simulated Bounce)',
    });

    const event: BlastEvent = {
      id: `sim-bounce-${Date.now()}-${Math.random()}`,
      campaignId: state.campaign.id,
      timestamp: Date.now(),
      level: 'warn',
      title: 'Simulation: Injected Fake Bounce',
      description: `Injected 550 Hard Bounce for ${email} on ${mailbox.displayName}. Check next evaluation tick.`,
      mailboxId,
      domainId: mailbox.domainId,
    };

    return {
      ...state,
      events: [event, ...state.events],
    };
  }

  /**
   * Injects a fake spam placement on seed checks for a specific mailbox
   */
  injectSimulatedSpamPlacement(mailboxId: string, state: EngineState): EngineState {
    const mailbox = state.mailboxes.find((m) => m.id === mailboxId);
    if (!mailbox) return state;

    (this.seedChecker as MockSeedChecker).injectPlacement(mailboxId, 'spam');

    const event: BlastEvent = {
      id: `sim-spam-${Date.now()}-${Math.random()}`,
      campaignId: state.campaign.id,
      timestamp: Date.now(),
      level: 'warn',
      title: 'Simulation: Injected Spam Placement',
      description: `Forced next seed check for ${mailbox.displayName} to land in SPAM (Test: 2 of last 3 in spam rule).`,
      mailboxId,
      domainId: mailbox.domainId,
    };

    return {
      ...state,
      events: [event, ...state.events],
    };
  }

  /**
   * Injects delayed-signal event to test backoff & stale signal alert
   */
  injectDelayedSignalEvent(mailboxId: string, state: EngineState): EngineState {
    const mailbox = state.mailboxes.find((m) => m.id === mailboxId);
    if (!mailbox) return state;

    const delayedSet = new Set(state.delayedSignalMailboxes);
    delayedSet.add(mailboxId);

    const updatedMailboxes = state.mailboxes.map((m) =>
      m.id === mailboxId ? { ...m, backoffActive: true } : m
    );

    const event: BlastEvent = {
      id: `sim-delay-${Date.now()}-${Math.random()}`,
      campaignId: state.campaign.id,
      timestamp: Date.now(),
      level: 'warn',
      title: 'Simulation: Signal Delayed (Backoff Active)',
      description: `Signals delayed beyond ${BLAST_CONFIG.SIGNAL_DELAY_THRESHOLD_SECONDS}s on ${mailbox.displayName}. Batch reduced to ${BLAST_CONFIG.BACKOFF_BATCH_SIZE} with 2x gap.`,
      mailboxId,
      domainId: mailbox.domainId,
    };

    // If more than 50% mailboxes have delayed signal, trigger campaign pause
    const activeCount = updatedMailboxes.filter((m) => m.status === 'active').length;
    let updatedCampaign = state.campaign;

    if (delayedSet.size / (activeCount || 1) >= BLAST_CONFIG.STALE_SIGNAL_RATIO_ALERT_THRESHOLD) {
      updatedCampaign = {
        ...state.campaign,
        status: 'alert_paused',
        rootCauseHint: 'Signal checker delay alert: most mailboxes have no signal for a long time. The checker may be broken.',
      };
    }

    return {
      ...state,
      campaign: updatedCampaign,
      mailboxes: updatedMailboxes,
      delayedSignalMailboxes: delayedSet,
      events: [event, ...state.events],
    };
  }
}

export const blastEngine = new BlastEngine();
