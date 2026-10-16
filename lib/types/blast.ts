/**
 * TypeScript Interfaces for Email Blast System
 * Real sending uses Google Workspace mailboxes only (Gmail API + SMTP fallback).
 * Bounces are read directly from the sending mailbox's own inbox.
 */

export type ProviderMode = 'simulation' | 'live';

export type RecipientStatus = 'pending' | 'sending' | 'sent' | 'bounced' | 'skipped';

export interface Recipient {
  id: string;
  email: string;
  name?: string;
  status: RecipientStatus;
  mailboxId?: string;
  sentAt?: number;
  bounceReason?: string;
  skipReason?: string;
  // Lease & idempotency locking for server worker
  leaseExpiresAt?: number;
  leaseWorkerId?: string;
  // Soft bounce retry tracking (max 2 retries)
  softBounceCount?: number;
  messageId?: string;
  unsubscribeToken?: string;
}

export type DomainStatus = 'active' | 'watch' | 'paused';

export interface BlastDomain {
  id: string;
  name: string;
  status: DomainStatus;
  flaggedMailboxCount: number;
}

export type MailboxStatus = 'active' | 'paused' | 'cooldown' | 'spare';

export interface BlastMailbox {
  id: string;
  email: string;
  displayName: string;
  domainId: string;
  dailyCap: number; // Max 50
  sentToday: number;
  status: MailboxStatus;
  totalSent: number;
  bouncesCount: number;
  bounceRate: number; // percentage
  recentSeedPlacements: ('inbox' | 'promotions' | 'spam')[];
  cooldownUntil?: number; // epoch ms
  rampPercent?: number; // ramp +10-20% per day
  backoffActive?: boolean;
  lastSignalReceivedAt?: number;
  assignedRecipientCount: number;
  healthFlaggedAt?: number;
  healthSentBaseline?: number;
  healthBounceBaseline?: number;
  dailyResetDate?: string;
  nextSendAt?: number;
  batchSentCount?: number;
  batchTarget?: number;
  signalCheckAt?: number;
  recipientSendsSinceSeed?: number;
  pendingSeedProbes?: { email: string; token: string }[];
}

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'alert_paused'
  | 'killed';

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  body: string;
  senderName: string;
  businessAddress: string;
  optOutText: string;
  sendingWindow: {
    start: string;
    end: string;
    timeZone?: string;
  };
  enableRamp: boolean;
  rampPercent: number;
  status: CampaignStatus;
  totalRecipients: number;
  sentCount: number;
  bouncedCount: number;
  pendingCount: number;
  skippedCount: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  rootCauseHint?: string;
  providerMode?: ProviderMode;
}

export type EventLevel = 'info' | 'warn' | 'error' | 'success';

export interface BlastEvent {
  id: string;
  campaignId: string;
  timestamp: number;
  level: EventLevel;
  title: string;
  description: string;
  mailboxId?: string;
  domainId?: string;
  rootCauseHint?: string;
}

export type SeedPlacement = 'inbox' | 'promotions' | 'spam';

export interface SeedCheckResult {
  seedEmail: string;
  placement: SeedPlacement;
  timestamp: number;
  mailboxId: string;
  campaignId: string;
  folderFound?: string;
}

export interface SeedAccount {
  id: string;
  email: string;
  provider: 'gmail' | 'outlook' | 'yahoo';
  status: 'connected' | 'disconnected' | 'pending';
  lastChecked?: number;
  lastPlacement?: SeedPlacement;
}

export interface BounceEvent {
  email: string;
  mailboxId: string;
  domainId: string;
  timestamp: number;
  type: 'hard' | 'soft';
  reason: string;
  statusCode?: string; // e.g. 5.1.1 or 4.2.2
  // Reply detection
  isReply?: boolean;
  isAutoReply?: boolean;
  replyBody?: string;
  messageId?: string;
}

// ── Provider Interfaces ──────────────────────────────────────────────────

export interface SendEmailParams {
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName?: string;
  replyTo?: string;
  subject: string;
  body: string;
  campaignId?: string;
  recipientId?: string;
  seedToken?: string;
  unsubscribeUrl?: string;
  listUnsubscribeHeader?: string;
  listUnsubscribePostHeader?: string;
  headers?: Record<string, string>;
}

export interface MailProvider {
  /**
   * Sends an email via simulated transport or Google Workspace Gmail API.
   * Supports List-Unsubscribe, List-Unsubscribe-Post, custom X-Blast headers.
   */
  sendEmail(params: SendEmailParams): Promise<{ messageId: string; success: boolean }>;
}

export interface BounceSource {
  /**
   * Polls sending mailbox inbox for delivery-failure notifications (DSNs)
   * and human/auto-replies.
   */
  getBounces(mailboxId: string): Promise<BounceEvent[]>;
  checkReplies?(mailboxEmail: string): Promise<{ email: string; isOptOut: boolean; body: string }[]>;
}

export interface SeedChecker {
  /**
   * Tests seed email placement (INBOX, SPAM, CATEGORY_PROMOTIONS).
   * Note: Promotions is NOT considered spam.
   */
  checkSeedPlacement(seedEmail: string, campaignId: string, mailboxId: string, seedToken?: string): Promise<SeedCheckResult>;
}
