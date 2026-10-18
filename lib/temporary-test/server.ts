// Server entry point. Import only from API routes/tests, never from client components.
import nodemailer from 'nodemailer';
import { createHash, randomUUID } from 'node:crypto';
import type { WorkspaceStore } from '../server/model';
import { seal } from '../server/secrets';
import { TEST_RULES, personalizeTest, testDate, testFooter, validTestEmail, type TestRecipient, type TestResult } from './config';
if (typeof window !== 'undefined') throw new Error('Temporary SMTP transport is server-only.');

export class TestRequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function authorizeTemporaryTest() {
  if (process.env.TEST_MODE_ENABLED !== 'true') throw new TestRequestError('Temporary test mode is disabled.', 403);
}
export function temporarySenderKey() {
  return createHash('sha256').update(`${process.env.SMTP_HOST || ''}:${process.env.TEST_FROM_EMAIL || process.env.SMTP_USER || 'unconfigured'}`).digest('hex').slice(0, 24);
}
function senderConfig(dryRun: boolean) {
  const email = process.env.TEST_FROM_EMAIL || process.env.SMTP_USER || '';
  const name = process.env.TEST_FROM_NAME || '';
  if (!dryRun && (!validTestEmail(email) || !name.trim() || /[\r\n]/.test(name))) throw new TestRequestError('Configure the server SMTP sender and sender name.');
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true';
  if (!dryRun && (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !Number.isInteger(port) || port < 1 || port > 65535 || !['true', 'false'].includes(process.env.SMTP_SECURE || 'false'))) throw new TestRequestError('Configure the server SMTP host, port, secure flag and credentials.');
  return { email, name, port, secure };
}
export function validateTestBatch(body: Record<string, unknown>) {
  if (!Array.isArray(body.recipients) || !body.recipients.length || body.recipients.length > TEST_RULES.batchSize) throw new TestRequestError('Each request must contain 1–10 recipients.');
  const recipients: TestRecipient[] = []; const seen = new Set<string>();
  for (const item of body.recipients) {
    const email = typeof item?.email === 'string' ? item.email.trim().toLowerCase() : '';
    if (!validTestEmail(email)) throw new TestRequestError('Invalid recipient address.');
    if (seen.has(email)) continue; seen.add(email);
    recipients.push({ email, name: typeof item.name === 'string' && !/[\r\n]/.test(item.name) ? item.name.slice(0, 100) : email.split('@')[0] });
  }
  for (const [key, max] of [['subject', 200], ['body', 50000], ['businessAddress', 500]] as const) {
    if (typeof body[key] !== 'string' || !(body[key] as string).trim() || (body[key] as string).length > max || (key !== 'body' && /[\r\n]/.test(body[key] as string))) throw new TestRequestError(`Enter a valid ${key}.`);
  }
  if (typeof body.batchId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.batchId)) throw new TestRequestError('Invalid batch identifier.');
  if (typeof body.dryRun !== 'boolean') throw new TestRequestError('Choose dry run or live test explicitly.');
  return { recipients, subject: body.subject as string, text: body.body as string, address: body.businessAddress as string, batchId: body.batchId, dryRun: body.dryRun };
}

type TestMessage = { from: { name: string; address: string }; to: string; replyTo: string; subject: string; text: string; headers: Record<string, string> };
type Dependencies = { store: WorkspaceStore; send?: (message: TestMessage) => Promise<unknown>; wait?: (ms: number) => Promise<void>; random?: () => number };
export async function sendTemporaryBatch(owner: string, body: Record<string, unknown>, deps: Dependencies) {
  const input = validateTestBatch(body); const sender = senderConfig(input.dryRun);
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  if (!input.dryRun && (!origin || !(new URL(origin).protocol === 'https:' || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))) throw new TestRequestError('Configure the canonical HTTPS app URL for unsubscribe links.');
  const senderKey = temporarySenderKey(); const ledgerOwner = `temporary-smtp:${input.dryRun ? 'dry:' + owner : 'live'}:${senderKey}`;
  const lease = randomUUID(); const started = Date.now();
  await deps.store.transact(ledgerOwner, (ledger) => {
    if (ledger.lease && ledger.lease.until > Date.now()) throw new TestRequestError('Another test batch is still running for this sender.', 409);
    ledger.lease = { token: lease, until: Date.now() + 120000 };
  });
  const transport = input.dryRun || deps.send ? undefined : nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: sender.port, secure: sender.secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  });
  const results: TestResult[] = [];
  try {
    for (let index = 0; index < input.recipients.length; index++) {
      const recipient = input.recipients[index];
      const result: TestResult = { ...recipient, status: 'not-sent', reason: '', attempted: false };
      const workspace = await deps.store.read(owner);
      if (workspace.killSwitch) result.reason = 'Not sent: emergency kill switch is active';
      else if (workspace.suppression[recipient.email]) result.reason = 'Not sent: recipient is suppressed';
      else if (Date.now() - started >= TEST_RULES.requestBudgetMs) result.reason = 'Not sent: batch time limit reached; no automatic retry';
      else {
        const id = createHash('sha256').update(`${owner}:${input.batchId}:${recipient.email}`).digest('hex');
        const reservation = await deps.store.transact(ledgerOwner, (ledger) => {
          if (ledger.lease?.token !== lease || ledger.lease.until < Date.now()) return 'expired';
          if (ledger.attempts[id]) return 'duplicate';
          const used = Object.values(ledger.attempts).filter((attempt) => testDate(attempt.startedAt) === testDate()).length;
          if (used >= TEST_RULES.dailyCap) return 'limit';
          ledger.attempts[id] = { id, campaignId: input.batchId, mailboxId: senderKey, status: 'dispatching', startedAt: Date.now() };
          return 'reserved';
        });
        if (reservation !== 'reserved') result.reason = reservation === 'limit' ? 'Not sent: daily limit reached, retry tomorrow' : reservation === 'duplicate' ? 'Not sent: an earlier attempt exists; no automatic retry' : 'Not sent: batch ownership expired';
        else {
          result.attempted = true;
          try {
            if (!input.dryRun) {
              const token = await seal({ owner, email: recipient.email, expires: Date.now() + 10 * 365 * 86400000 });
              const landing = new URL('/unsubscribe', origin); landing.searchParams.set('token', token);
              const endpoint = new URL('/api/unsubscribe', origin); endpoint.searchParams.set('token', token);
              const message = { from: { name: sender.name, address: sender.email }, to: recipient.email, replyTo: sender.email,
                subject: personalizeTest(input.subject, recipient),
                text: personalizeTest(input.text, recipient) + testFooter(sender.name, input.address, landing.href),
                headers: { 'List-Unsubscribe': `<${endpoint.href}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
              const response = await (deps.send ? deps.send(message) : transport!.sendMail(message));
              const rejected = (response as { rejected?: unknown[] })?.rejected;
              if (rejected?.length) throw Object.assign(new Error('Rejected'), { responseCode: 550 });
            }
            result.status = 'sent'; result.reason = input.dryRun ? 'Dry run: simulated sent; no email dispatched' : 'SMTP accepted the message (inbox placement is not guaranteed)';
            await deps.store.transact(ledgerOwner, (ledger) => { ledger.attempts[id].status = 'accepted'; });
          } catch (error) {
            result.status = 'failed';
            const code = (error as { responseCode?: number }).responseCode;
            result.reason = Number.isInteger(code) ? `SMTP rejected the message (code ${code}). No automatic retry.` : 'Send failed or delivery is uncertain. No automatic retry; check Sent before trying again.';
            await deps.store.transact(ledgerOwner, (ledger) => { ledger.attempts[id].status = 'unknown'; });
          }
        }
      }
      results.push(result);
      if (index < input.recipients.length - 1) {
        const gap = TEST_RULES.gapMinSeconds + Math.floor((deps.random || Math.random)() * (TEST_RULES.gapMaxSeconds - TEST_RULES.gapMinSeconds + 1));
        await (deps.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(gap * 1000);
      }
    }
  } finally {
    transport?.close();
    await deps.store.transact(ledgerOwner, (ledger) => { if (ledger.lease?.token === lease) ledger.lease = undefined; });
  }
  const ledger = await deps.store.read(ledgerOwner);
  const usedToday = Object.values(ledger.attempts).filter((attempt) => testDate(attempt.startedAt) === testDate()).length;
  return { results, senderKey, remainingToday: Math.max(0, TEST_RULES.dailyCap - usedToday) };
}
