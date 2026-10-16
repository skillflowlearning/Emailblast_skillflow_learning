/**
 * Google Workspace Gmail API Provider & Bounce Parser
 * Authenticates via Google Service Account with Domain-Wide Delegation,
 * impersonating each Google Workspace mailbox (scopes: gmail.send, gmail.readonly, gmail.modify).
 * Features SMTP fallback via Nodemailer when SMTP credentials are provided.
 * Bounces are parsed directly from the sending mailbox's own inbox.
 */

import crypto from 'crypto';
import nodemailer from 'nodemailer';
import {
  MailProvider,
  BounceSource,
  SeedChecker,
  SendEmailParams,
  BounceEvent,
  SeedCheckResult,
} from '@/lib/types/blast';
import { BLAST_CONFIG, hasLiveGoogleCredentials, hasLiveSmtpCredentials } from '@/lib/config/blastConfig';

// In-memory token cache for Google Service Account impersonation: mailboxEmail -> { token, expiresAt }
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const gmailFetch = (url: string, options: RequestInit = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) });

async function listSignalMessages(token: string, query: string): Promise<{ id: string }[]> {
  const messages: { id: string }[] = []; let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ q: query, maxResults: '20', ...(pageToken ? { pageToken } : {}) });
    const response = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Signal message lookup failed.');
    const data = await response.json() as { messages?: { id: string }[]; nextPageToken?: string };
    messages.push(...(data.messages || [])); pageToken = data.nextPageToken;
    if (!pageToken) return messages;
  }
  throw new Error('Signal backlog exceeds the scan limit. Review it before sending continues.');
}

interface GmailPart {
  body?: { data?: string };
  parts?: GmailPart[];
}

export function decodeGmailParts(part?: GmailPart): string {
  if (!part) return '';
  return [part.body?.data ? Buffer.from(part.body.data, 'base64url').toString('utf8') : '',
    ...(part.parts || []).map(decodeGmailParts)].filter(Boolean).join('\n');
}

/**
 * Service Account OAuth2 Assertion Helper
 * Signs a JWT using RSA-SHA256 with the service account private key and exchanges
 * it for a Google OAuth2 access token scoped to the impersonated mailbox.
 */
export async function getGoogleMailboxAccessToken(mailboxEmail: string): Promise<string> {
  const cached = tokenCache.get(mailboxEmail);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.token;
  }

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error(
      'Missing Google Service Account credentials. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in .env.local.'
    );
  }

  // Handle escaped newlines in env variables
  privateKey = privateKey.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: clientEmail,
    sub: mailboxEmail, // Impersonated Google Workspace user
    scope: BLAST_CONFIG.GMAIL_SCOPES.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedClaimSet = Buffer.from(JSON.stringify(claimSet)).toString('base64url');
  const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signatureInput);
  const signature = signer.sign(privateKey, 'base64url');

  const jwtAssertion = `${signatureInput}.${signature}`;

  // Exchange JWT for OAuth2 token
  const res = await gmailFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwtAssertion,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `Failed to obtain Google access token for ${mailboxEmail}: HTTP ${res.status} - ${errorBody}`
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(mailboxEmail, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });

  return data.access_token;
}

/**
 * Builds RFC 2822 MIME plain-text message with required compliance headers
 */
export function buildMimeMessage(params: SendEmailParams): string {
  const domain = params.fromEmail.split('@')[1] || 'domain.com';
  const messageId = params.rfcMessageId || `<blast-${Date.now()}-${crypto.randomBytes(6).toString('hex')}@${domain}>`;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://' + domain;
  const unsubEmail = `unsubscribe@${domain}`;
  const unsubHttp = params.unsubscribeUrl || `${baseUrl}/unsubscribe?token=${encodeURIComponent(params.toEmail)}`;

  const listUnsub =
    params.listUnsubscribeHeader || `<mailto:${unsubEmail}?subject=unsubscribe>, <${unsubHttp}>`;
  const listUnsubPost = params.listUnsubscribePostHeader || 'List-Unsubscribe=One-Click';

  const lines: string[] = [
    `From: "${params.fromName.replace(/"/g, '')}" <${params.fromEmail}>`,
    `To: ${params.toName ? `"${params.toName.replace(/"/g, '')}" <${params.toEmail}>` : params.toEmail}`,
    `Reply-To: <${params.replyTo || params.fromEmail}>`,
    `Subject: =?UTF-8?B?${Buffer.from(params.subject).toString('base64')}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    `X-Blast-Campaign: ${params.campaignId || 'default'}`,
    `X-Blast-Recipient: ${params.recipientId || params.toEmail}`,
    `X-Blast-Seed: ${params.seedToken || 'none'}`,
    `List-Unsubscribe: ${listUnsub}`,
    `List-Unsubscribe-Post: ${listUnsubPost}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    params.body,
  ];

  return lines.join('\r\n');
}

/**
 * Real GmailMailProvider
 * Sends messages using the Gmail API (REST messages.send) with domain-wide delegation,
 * with Nodemailer SMTP fallback if configured.
 */
export class GmailMailProvider implements MailProvider {
  constructor(private tokenResolver?: (email: string) => Promise<string>) {}
  async sendEmail(params: SendEmailParams): Promise<{ messageId: string; success: boolean }> {
    // 1. Primary: Google Workspace Gmail API via Domain-Wide Delegation
    if (this.tokenResolver || hasLiveGoogleCredentials()) {
      let dispatchStarted = false;
      try {
        const token = await (this.tokenResolver || getGoogleMailboxAccessToken)(params.fromEmail);
        const mime = buildMimeMessage(params);
        const rawBase64Url = Buffer.from(mime).toString('base64url');

        dispatchStarted = true;
        const res = await gmailFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw: rawBase64Url }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Gmail API send failed: ${res.status} ${errText}`);
        }

        const data = (await res.json()) as { id: string };
        return { messageId: data.id, success: true };
      } catch (err) {
        // If SMTP fallback credentials exist, attempt fallback
        if (!this.tokenResolver && !dispatchStarted && hasLiveSmtpCredentials()) {
          console.warn('[GmailMailProvider] Gmail API failed, falling back to SMTP:', err);
          return this.sendViaSmtp(params);
        }
        throw err;
      }
    }

    // 2. Fallback: Authenticated SMTP via Nodemailer
    if (hasLiveSmtpCredentials()) {
      return this.sendViaSmtp(params);
    }

    throw new Error(
      'Live sending requires either Google Service Account credentials or SMTP credentials.'
    );
  }

  private async sendViaSmtp(params: SendEmailParams): Promise<{ messageId: string; success: boolean }> {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const info = await transporter.sendMail({
      from: `"${params.fromName}" <${params.fromEmail}>`,
      to: params.toEmail,
      replyTo: params.replyTo || params.fromEmail,
      subject: params.subject,
      text: params.body,
      headers: {
        'X-Blast-Campaign': params.campaignId || 'default',
        'X-Blast-Recipient': params.recipientId || params.toEmail,
        'X-Blast-Seed': params.seedToken || 'none',
        'List-Unsubscribe':
          params.listUnsubscribeHeader || `<mailto:unsubscribe@${params.fromEmail.split('@')[1]}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });

    return { messageId: info.messageId, success: true };
  }
}

/**
 * Real GmailBounceSource
 * Polls the sending mailbox's own inbox for Delivery Status Notifications (DSNs)
 * from mailer-daemon/postmaster, parses DSN error codes (5.x.x hard, 4.x.x soft),
 * and checks for incoming human replies / opt-out keywords.
 */
export class GmailBounceSource implements BounceSource {
  constructor(private tokenResolver?: (email: string) => Promise<string>) {}
  async getBounces(mailboxId: string): Promise<BounceEvent[]> {
    if (!this.tokenResolver && !hasLiveGoogleCredentials()) {
      throw new Error('Google credentials are required for bounce checks.');
    }

    try {
      const mailboxEmail = mailboxId.includes('@') ? mailboxId : null;
      if (!mailboxEmail) throw new Error('A mailbox email address is required for bounce checks.');

      const token = await (this.tokenResolver || getGoogleMailboxAccessToken)(mailboxEmail);

      // Search for Delivery Status Notifications in inbox
      const query = 'in:anywhere from:(mailer-daemon OR postmaster) newer_than:2d';
      const messages = await listSignalMessages(token, query);
      if (!messages.length) return [];

      const events: BounceEvent[] = [];

      for (const msg of messages) {
        const msgRes = await gmailFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!msgRes.ok) throw new Error('Could not read a bounce message.');

        const msgData = await msgRes.json();
        const snippet = msgData.snippet || '';
        const bodyContent = decodeGmailParts(msgData.payload);

        // Parse failed recipient email
        const emailMatch = bodyContent.match(
          /(?:Final-Recipient|Original-Recipient):\s*(?:rfc822;)?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i
        );
        const bouncedEmail = emailMatch ? emailMatch[1].toLowerCase() : null;

        // Determine if hard (5.x.x) or soft (4.x.x) bounce
        const statusMatch = bodyContent.match(/Status:\s*([45]\.\d+\.\d+)/i);
        const statusCode = statusMatch ? statusMatch[1] : '5.1.1';
        const isHard = statusCode.startsWith('5');

        if (bouncedEmail) {
          events.push({
            email: bouncedEmail,
            mailboxId,
            domainId: mailboxEmail.split('@')[1] || '',
            timestamp: parseInt(msgData.internalDate, 10) || Date.now(),
            type: isHard ? 'hard' : 'soft',
            statusCode,
            messageId: msg.id,
            reason: snippet || `DSN Delivery Failure (${statusCode})`,
          });
        }
      }

      return events;
    } catch (err) {
      throw new Error('Bounce check unavailable. Sending must wait for signals.');
    }
  }

  /**
   * Scans inbox for human replies and opt-outs.
   * Auto-replies (Auto-Submitted, Out of Office) are filtered out.
   */
  async checkReplies(mailboxEmail: string): Promise<{ email: string; isOptOut: boolean; body: string }[]> {
    if (!this.tokenResolver && !hasLiveGoogleCredentials()) throw new Error('Google credentials are required for reply checks.');

    try {
      const token = await (this.tokenResolver || getGoogleMailboxAccessToken)(mailboxEmail);
      const query = 'is:inbox -from:(mailer-daemon OR postmaster) newer_than:2d';
      const messages = await listSignalMessages(token, query);

      const replies: { email: string; isOptOut: boolean; body: string }[] = [];

      for (const msg of messages) {
        const msgRes = await gmailFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!msgRes.ok) throw new Error('Could not read a reply.');

        const msgData = await msgRes.json();
        const headers = (msgData.payload?.headers || []) as { name: string; value: string }[];

        const autoSubmitted = headers.find((h) => h.name.toLowerCase() === 'auto-submitted')?.value;
        const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value || '';
        const fromHeader = headers.find((h) => h.name.toLowerCase() === 'from')?.value || '';
        const inReplyTo = headers.find((h) => h.name.toLowerCase() === 'in-reply-to')?.value;
        const references = headers.find((h) => h.name.toLowerCase() === 'references')?.value;
        if (!inReplyTo && !references) continue;

        // Filter out auto-replies (out of office / auto-submitted)
        if (
          (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') ||
          /out of office|auto-reply|automatic reply|vacation/i.test(subject)
        ) {
          continue; // Auto-replies must not count as human replies
        }

        const emailMatch = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        const senderEmail = emailMatch ? emailMatch[1].toLowerCase() : null;
        if (!senderEmail) continue;

        const snippet = decodeGmailParts(msgData.payload) || msgData.snippet || '';
        const isOptOut = /\b(stop|unsubscribe|remove me|opt-out|optout)\b/i.test(snippet);

        replies.push({
          email: senderEmail,
          isOptOut,
          body: snippet,
        });
      }

      return replies;
    } catch (err) {
      throw new Error('Reply check unavailable. Sending must wait for signals.');
    }
  }
}

/**
 * Real GmailSeedChecker (Phase 1)
 * Connects to seed inboxes via Gmail API, matches seed tokens,
 * and reads labels: INBOX, SPAM, CATEGORY_PROMOTIONS.
 * Promotions is NOT spam.
 */
export class GmailSeedChecker implements SeedChecker {
  constructor(private tokenResolver?: (email: string) => Promise<string>) {}
  async checkSeedPlacement(
    seedEmail: string,
    campaignId: string,
    mailboxId: string,
    seedToken?: string,
  ): Promise<SeedCheckResult> {
    if (this.tokenResolver || hasLiveGoogleCredentials()) {
      try {
        const token = await (this.tokenResolver || getGoogleMailboxAccessToken)(seedEmail);

        // Search for message received by seed inbox
        if (!seedToken) throw new Error('A seed token is required to match this probe.');
        const q = `in:anywhere to:${seedEmail} from:${mailboxId} "${seedToken}" newer_than:2d`;
        const listRes = await gmailFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=5`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (listRes.ok) {
          const listData = (await listRes.json()) as { messages?: { id: string }[] };
          if (listData.messages && listData.messages.length > 0) {
            const firstMsgId = listData.messages[0].id;
            const msgRes = await gmailFetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${firstMsgId}?format=minimal`,
              { headers: { Authorization: `Bearer ${token}` } }
            );

            if (msgRes.ok) {
              const msgData = (await msgRes.json()) as { labelIds?: string[] };
              const labelIds = msgData.labelIds || [];

              if (labelIds.includes('SPAM')) {
                return {
                  seedEmail,
                  placement: 'spam',
                  timestamp: Date.now(),
                  mailboxId,
                  campaignId,
                  folderFound: 'SPAM',
                };
              }

              if (labelIds.includes('CATEGORY_PROMOTIONS')) {
                // Promotions is NOT spam
                return {
                  seedEmail,
                  placement: 'promotions',
                  timestamp: Date.now(),
                  mailboxId,
                  campaignId,
                  folderFound: 'CATEGORY_PROMOTIONS',
                };
              }

              if (!labelIds.includes('INBOX')) throw new Error('Seed message has no supported placement label.');
              return {
                seedEmail,
                placement: 'inbox',
                timestamp: Date.now(),
                mailboxId,
                campaignId,
                folderFound: 'INBOX',
              };
            }
          }
        }
      } catch (err) {
        console.warn('[GmailSeedChecker] Live seed placement lookup error:', err);
      }
    }

    throw new Error('Seed placement is unavailable. Do not assume inbox delivery.');
  }

  /**
   * TODO: Microsoft Outlook / Office 365 Seed Checker
   * Connect via Microsoft Graph API with application permissions (Mail.Read)
   * to query folder placement: Inbox vs JunkEmail.
   */

  /**
   * TODO: Yahoo Mail Seed Checker
   * Connect via IMAP over OAuth2 / App Password to check folder: INBOX vs Bulk.
   */
}
