import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { decodeGmailParts, GmailSeedChecker, GmailBounceSource, GmailMailProvider } from '../lib/services/gmailProvider';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
async function withGoogle<T>(run: () => Promise<T>): Promise<T> {
  const keys = ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  const original = keys.map((key) => process.env[key]);
  const fetch = globalThis.fetch;
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'service@test.invalid';
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey;
  try { return await run(); } finally {
    globalThis.fetch = fetch;
    keys.forEach((key, i) => { if (original[i] === undefined) delete process.env[key]; else process.env[key] = original[i]; });
  }
}
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

test('Gmail payload decoding reads nested base64url delivery status parts', () => {
  const status = 'Final-Recipient: rfc822; person@example.com\r\nStatus: 5.1.1';
  assert.equal(decodeGmailParts({ parts: [{ parts: [{ body: { data: Buffer.from(status).toString('base64url') } }] }] }), status);
});

test('seed check searches spam folders and matches the exact sending mailbox and probe token', async () => {
  await withGoogle(async () => {
    let query = '';
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('oauth2')) return json({ access_token: 'test-token', expires_in: 3600 });
      if (url.includes('/messages?')) { query = new URL(url).searchParams.get('q')!; return json({ messages: [{ id: 'seed-message' }] }); }
      return json({ labelIds: ['SPAM'] });
    };
    const result = await new GmailSeedChecker().checkSeedPlacement('seed@test.invalid', 'campaign', 'sender@test.invalid', 'unique-probe');
    assert.equal(result.placement, 'spam');
    assert.match(query, /in:anywhere/); assert.match(query, /from:sender@test.invalid/); assert.match(query, /unique-probe/);
  });
});

test('a missing seed message throws instead of returning a healthy inbox result', async () => {
  await withGoogle(async () => {
    globalThis.fetch = async (input) => String(input).includes('oauth2')
      ? json({ access_token: 'test-token', expires_in: 3600 }) : json({ messages: [] });
    await assert.rejects(new GmailSeedChecker().checkSeedPlacement('seed@test.invalid', 'campaign', 'sender@test.invalid', 'missing-probe'));
  });
});

test('live bounce parser decodes DSN recipient and preserves the notification ID', async () => {
  await withGoogle(async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('oauth2')) return json({ access_token: 'test-token', expires_in: 3600 });
      if (url.includes('/messages?')) return json({ messages: [{ id: 'dsn-123' }] });
      return json({ internalDate: '1000', payload: { parts: [{ body: { data: Buffer.from('Final-Recipient: rfc822; bounced@example.com\r\nStatus: 5.1.1').toString('base64url') } }] } });
    };
    const result = await new GmailBounceSource().getBounces('sender@test.invalid');
    assert.equal(result[0].email, 'bounced@example.com'); assert.equal(result[0].type, 'hard');
    assert.equal(result[0].messageId, 'dsn-123');
  });
});

test('a failed bounce API call is not treated as an empty healthy signal', async () => {
  await withGoogle(async () => {
    globalThis.fetch = async (input) => String(input).includes('oauth2')
      ? json({ access_token: 'test-token', expires_in: 3600 }) : new Response('Unavailable', { status: 503 });
    await assert.rejects(new GmailBounceSource().getBounces('sender@test.invalid'));
  });
});

test('SMTP is not retried after Gmail dispatch starts and its response is lost', async () => {
  await withGoogle(async () => {
    process.env.SMTP_HOST = 'smtp.test.invalid'; process.env.SMTP_USER = 'sender'; process.env.SMTP_PASS = 'test';
    globalThis.fetch = async (input) => {
      if (String(input).includes('oauth2')) return json({ access_token: 'test-token', expires_in: 3600 });
      throw new Error('Response lost after sending');
    };
    let smtpCalls = 0;
    const provider = new GmailMailProvider();
    Object.assign(provider, { sendViaSmtp: async () => { smtpCalls++; return { success: true, messageId: 'smtp' }; } });
    await assert.rejects(provider.sendEmail({ fromEmail: 'sender@test.invalid', fromName: 'Test', toEmail: 'person@test.invalid', subject: 'Test', body: 'Test' }));
    assert.equal(smtpCalls, 0);
  });
});

test('bounce scan reads later pages rather than missing their notifications', async () => {
  await withGoogle(async () => {
    let pages = 0;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/messages')) {
        pages++;
        if (!url.searchParams.has('pageToken')) return json({ messages: [], nextPageToken: 'next-page' });
        assert.equal(url.searchParams.get('pageToken'), 'next-page');
        return json({ messages: [{ id: 'later-dsn' }] });
      }
      return json({ internalDate: '2000', payload: { body: { data: Buffer.from('Final-Recipient: rfc822; later@example.com\r\nStatus: 5.1.1').toString('base64url') } } });
    };
    const events = await new GmailBounceSource(async () => 'test-token').getBounces('sender@test.invalid');
    assert.equal(pages, 2); assert.equal(events[0].email, 'later@example.com');
  });
});

test('a signal backlog beyond the bounded scan cannot be reported as healthy', async () => {
  await withGoogle(async () => {
    let pages = 0;
    globalThis.fetch = async () => { pages++; return json({ messages: [], nextPageToken: 'more' }); };
    await assert.rejects(new GmailBounceSource(async () => 'test-token').getBounces('sender@test.invalid'));
    assert.equal(pages, 5);
  });
});
