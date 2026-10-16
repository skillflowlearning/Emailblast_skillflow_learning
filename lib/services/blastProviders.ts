/**
 * Email Blast Transport & Signal Providers
 * Supports Simulation Mode and Live Google Workspace (Gmail API / SMTP fallback).
 * Bounces are parsed directly from the sending mailbox inbox (DSNs).
 */

import {
  MailProvider,
  BounceSource,
  SeedChecker,
  SendEmailParams,
  BounceEvent,
  SeedCheckResult,
  SeedPlacement,
} from '@/lib/types/blast';
import { BLAST_CONFIG } from '@/lib/config/blastConfig';

/**
 * Mock Mail Transport Provider (Simulation Mode)
 * Implements List-Unsubscribe header stub and safe mock sending.
 */
export class MockMailProvider implements MailProvider {
  /**
   * Simulated transport.
   * Real production sending uses GmailMailProvider (Google Workspace Gmail API / SMTP fallback).
   */
  async sendEmail(params: SendEmailParams): Promise<{ messageId: string; success: boolean }> {
    const domainMatch = params.fromEmail.match(/@(.+)$/);
    const domain = domainMatch ? domainMatch[1] : 'domain.com';
    const unsubEmail = `unsubscribe@${domain}`;
    const unsubUrl = `https://${domain}/api/unsubscribe?recipient=${encodeURIComponent(params.toEmail)}`;

    const listUnsubHeader =
      params.listUnsubscribeHeader || `<mailto:${unsubEmail}?subject=unsubscribe>, <${unsubUrl}>`;

    // Simulate network latency (20-60ms)
    await new Promise((resolve) => setTimeout(resolve, 30));

    const messageId = `mock-msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    void listUnsubHeader;

    return {
      messageId,
      success: true,
    };
  }
}

/**
 * Mock Bounce Source (Simulation Mode)
 * Simulates DSN delivery-failure reports read from the mailbox inbox.
 */
export class MockBounceSource implements BounceSource {
  private injectedBounces: BounceEvent[] = [];

  /**
   * Returns bounces queued for this mailbox.
   * In live mode, GmailBounceSource polls the mailbox's own inbox for DSNs.
   */
  async getBounces(mailboxId: string): Promise<BounceEvent[]> {
    const matches = this.injectedBounces.filter((b) => b.mailboxId === mailboxId);
    this.injectedBounces = this.injectedBounces.filter((b) => b.mailboxId !== mailboxId);
    return matches;
  }

  /**
   * Injects simulated DSN delivery failure for testing auto-rules
   */
  injectBounce(bounce: BounceEvent): void {
    this.injectedBounces.push(bounce);
  }
}

/**
 * Mock Seed Placement Checker (Simulation Mode)
 * Tests seed deliverability (inbox | promotions | spam).
 * Note: Promotions is NOT considered spam.
 */
export class MockSeedChecker implements SeedChecker {
  private forcedPlacements: Map<string, SeedPlacement[]> = new Map();

  async checkSeedPlacement(
    seedEmail: string,
    campaignId: string,
    mailboxId: string
  ): Promise<SeedCheckResult> {
    await new Promise((resolve) => setTimeout(resolve, 40));

    const queue = this.forcedPlacements.get(mailboxId);
    let placement: SeedPlacement = 'inbox';

    if (queue && queue.length > 0) {
      placement = queue.shift()!;
    } else {
      const rand = Math.random();
      if (rand < 0.85) {
        placement = 'inbox';
      } else if (rand < 0.97) {
        // Promotions is NOT spam
        placement = 'promotions';
      } else {
        placement = 'spam';
      }
    }

    return {
      seedEmail,
      placement,
      timestamp: Date.now(),
      mailboxId,
      campaignId,
      folderFound: placement.toUpperCase(),
    };
  }

  /**
   * Injects placement for testing the 2-of-last-3 spam rule
   */
  injectPlacement(mailboxId: string, placement: SeedPlacement): void {
    const existing = this.forcedPlacements.get(mailboxId) || [];
    existing.push(placement);
    this.forcedPlacements.set(mailboxId, existing);
  }
}

// Singleton mock instances for shared simulation state
export const defaultMockMailProvider = new MockMailProvider();
export const defaultMockBounceSource = new MockBounceSource();
export const defaultMockSeedChecker = new MockSeedChecker();

// Active providers for universal/client execution
export function getActiveMailProvider(): MailProvider {
  return defaultMockMailProvider;
}

export function getActiveBounceSource(): BounceSource {
  return defaultMockBounceSource;
}

export function getActiveSeedChecker(): SeedChecker {
  return defaultMockSeedChecker;
}

// Default export compatibility
export const defaultMailProvider = defaultMockMailProvider;
export const defaultBounceSource = defaultMockBounceSource;
export const defaultSeedChecker = defaultMockSeedChecker;
