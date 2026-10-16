/**
 * Blast Auto-Rules & Operational Constants
 * Centralized configuration file for all email blast sending limits and safety rules.
 * Real sending is powered exclusively by Google Workspace mailboxes (Gmail API / SMTP fallback).
 */

export const BLAST_CONFIG = {
  // Provider Mode: 'simulation' (default) or 'live'
  PROVIDER_MODE: (process.env.NEXT_PUBLIC_BLAST_PROVIDER_MODE ||
    process.env.BLAST_PROVIDER_MODE ||
    'simulation') as 'simulation' | 'live',

  // Google Workspace API Scopes (Domain-Wide Delegation)
  GMAIL_SCOPES: [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
  ],

  // Server Worker & Idempotency Leases
  LEASE_TIMEOUT_MS: 60 * 1000, // 60-second lease to prevent double sends
  MAX_SOFT_BOUNCE_RETRIES: 2, // Retry 4.x.x soft bounces at most twice

  // Recipient Constraints
  MAX_RECIPIENTS: 10000,
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB

  // Mailbox Capacity Rules
  DEFAULT_MAILBOX_DAILY_CAP: 30,
  HARD_MAX_MAILBOX_DAILY_CAP: 50, // Constant: UI and engine can NEVER exceed this
  DEFAULT_RAMP_PERCENT: 15, // Optional ramp +10-20% per healthy day
  MIN_RAMP_PERCENT: 10,
  MAX_RAMP_PERCENT: 20,

  // Sending Window
  DEFAULT_SENDING_WINDOW: {
    start: '10:00',
    end: '18:00',
    timeZone: 'Asia/Kolkata',
  },

  // Batch Sending Engine
  BATCH_SIZE_MIN: 10,
  BATCH_SIZE_MAX: 15,
  SEND_GAP_SECONDS_MIN: 30, // 30-120 second gaps between emails in a batch
  SEND_GAP_SECONDS_MAX: 120,
  SIGNAL_EVALUATION_WAIT_SECONDS: 120, // ~2 minutes wait after batch before evaluating signals

  // Signal Delay & Backoff Safeguards
  SIGNAL_DELAY_THRESHOLD_SECONDS: 240, // Beyond this, signal is considered delayed
  BACKOFF_BATCH_SIZE: 5, // Reduced batch size during signal delay
  BACKOFF_GAP_MULTIPLIER: 2.0, // Increase gap between sends during backoff
  STALE_SIGNAL_RATIO_ALERT_THRESHOLD: 0.5, // If >50% mailboxes have delayed signal, pause campaign

  // Seed List Monitoring
  SEED_INTERVAL: 11, // Every ~11th email goes to a seed address
  LIVE_SEEDS: (process.env.BLAST_SEED_EMAILS || '').split(',').map((email) => email.trim()).filter(Boolean),
  DEFAULT_SEEDS: [
    'seed.inbox1@inboxprobe.org',
    'seed.inbox2@deliverability-test.io',
    'seed.inbox3@seedchecker.dev',
    'seed.inbox4@mailpulse-seeds.com',
    'seed.inbox5@inboxmonitor.net',
    'seed.inbox6@spamwatch-node.co',
    'seed.inbox7@seedlab-audit.org',
  ],

  // Auto Safety Rules Thresholds
  // 1. Seed spam placement: 2 of last 3 in spam -> pause mailbox, domain 'watch'
  SEED_SPAM_CHECK_WINDOW: 3,
  SEED_SPAM_FAIL_COUNT: 2,

  // 2. Domain-level degradation: 2 or more mailboxes flagged -> pause whole domain
  DOMAIN_FLAGGED_MAILBOXES_LIMIT: 2,

  // 3. Bounce rate threshold: > 3% once at least 50 emails sent from that mailbox
  BOUNCE_RATE_THRESHOLD_PERCENT: 3.0,
  BOUNCE_RATE_MIN_SENT_EMAILS: 50,

  // 4. Cooldown and gradual recovery
  COOLDOWN_HOURS_DEFAULT: 48, // 48-72 hours
  RESUME_DAILY_CAP_INITIAL: 8, // Resume at 5-10/day after cooldown

  // Default Demo Mailbox Fleet (3 domains x 3 mailboxes + 1 spare mailbox)
  DEFAULT_DOMAINS: [
    {
      id: 'dom-1',
      name: 'mail.acme-sales.com',
      status: 'active' as const,
    },
    {
      id: 'dom-2',
      name: 'outreach.acme-connect.net',
      status: 'active' as const,
    },
    {
      id: 'dom-3',
      name: 'dispatch.acme-growth.io',
      status: 'active' as const,
    },
  ],

  DEFAULT_MAILBOXES: [
    // Domain 1: 3 mailboxes
    {
      id: 'mbx-1',
      email: 'alex@mail.acme-sales.com',
      displayName: 'Alex (Sales 1)',
      domainId: 'dom-1',
      dailyCap: 30,
      status: 'active' as const,
    },
    {
      id: 'mbx-2',
      email: 'jordan@mail.acme-sales.com',
      displayName: 'Jordan (Sales 2)',
      domainId: 'dom-1',
      dailyCap: 30,
      status: 'active' as const,
    },
    {
      id: 'mbx-3',
      email: 'taylor@mail.acme-sales.com',
      displayName: 'Taylor (Sales 3)',
      domainId: 'dom-1',
      dailyCap: 30,
      status: 'active' as const,
    },

    // Domain 2: 3 mailboxes
    {
      id: 'mbx-4',
      email: 'chris@outreach.acme-connect.net',
      displayName: 'Chris (Outreach 1)',
      domainId: 'dom-2',
      dailyCap: 30,
      status: 'active' as const,
    },
    {
      id: 'mbx-5',
      email: 'sam@outreach.acme-connect.net',
      displayName: 'Sam (Outreach 2)',
      domainId: 'dom-2',
      dailyCap: 30,
      status: 'active' as const,
    },
    {
      id: 'mbx-6',
      email: 'morgan@outreach.acme-connect.net',
      displayName: 'Morgan (Outreach 3)',
      domainId: 'dom-2',
      dailyCap: 30,
      status: 'active' as const,
    },

    // Domain 3: 3 mailboxes
    {
      id: 'mbx-7',
      email: 'pat@dispatch.acme-growth.io',
      displayName: 'Pat (Growth 1)',
      domainId: 'dom-3',
      dailyCap: 30,
      status: 'active' as const,
    },
    {
      id: 'mbx-8',
      email: 'riley@dispatch.acme-growth.io',
      displayName: 'Riley (Growth 2)',
      domainId: 'dom-3',
      dailyCap: 30,
      status: 'active' as const,
    },
    {
      id: 'mbx-9',
      email: 'avery@dispatch.acme-growth.io',
      displayName: 'Avery (Growth 3)',
      domainId: 'dom-3',
      dailyCap: 30,
      status: 'active' as const,
    },

    // 1 Spare Mailbox for fallback
    {
      id: 'mbx-spare',
      email: 'backup@dispatch.acme-growth.io',
      displayName: 'Spare Mailbox (Backup)',
      domainId: 'dom-3',
      dailyCap: 30,
      status: 'spare' as const,
    },
  ],
};

/**
 * Checks if live credentials exist on the server
 */
export function hasLiveGoogleCredentials(): boolean {
  const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const saKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  return Boolean(saEmail && saKey && saEmail.includes('@') && saKey.includes('PRIVATE KEY'));
}

export function hasLiveSmtpCredentials(): boolean {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  return Boolean(host && user && pass);
}

export function canRunLiveSending(): boolean {
  return hasLiveGoogleCredentials() || hasLiveSmtpCredentials();
}
