import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeTemporaryTest, sendTemporaryBatch, validateTestBatch } from '../lib/temporary-test/server';
import { parseTestRecipients, TEST_RULES } from '../lib/temporary-test/config';
import { emptyWorkspace, type Workspace, type WorkspaceStore } from '../lib/server/model';

class MemoryStore implements WorkspaceStore {
  records = new Map<string, Workspace>();
  async read(owner: string) { return structuredClone(this.records.get(owner) || emptyWorkspace(owner)); }
  async transact<T>(owner: string, change: (workspace: Workspace) => T) { const state = await this.read(owner); const result = change(state); this.records.set(owner, state); return result; }
  async dueOwners() { return []; }
}
const draft = (count = 1, dryRun = true) => ({ recipients: Array.from({ length: count }, (_, i) => ({ email: `owned${i}@example.com`, name: `Owner${i}` })), subject: 'Hi {{name}}', body: 'Hello {{name}}', businessAddress: '123 Test Street', batchId: 'fixture-batch-123', dryRun });
async function withConfig(run: () => Promise<void>) {
  const config = { TEST_MODE_ENABLED: 'true', SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USER: 'sender@example.com', SMTP_PASS: 'fixture-only-password', TEST_FROM_NAME: 'Test Sender', TEST_FROM_EMAIL: 'sender@example.com', NEXT_PUBLIC_APP_URL: 'http://localhost:3000', BLAST_APP_SECRET: 'fixture-only-app-secret-at-least-32-characters' };
  const previous = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
  Object.assign(process.env, config);
  try { await run(); } finally { for (const key of Object.keys(config)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
}
test('temporary test requires enabled mode', async () => withConfig(async () => {
  authorizeTemporaryTest();
  process.env.TEST_MODE_ENABLED = 'false'; assert.throws(() => authorizeTemporaryTest());
}));
test('temporary test parses separators, removes duplicates and rejects invalid syntax/oversized batches', () => {
  const parsed = parseTestRecipients('Me@example.com, me@example.com\nsecond@example.com third@example.com invalid');
  assert.equal(parsed.recipients.length, 3); assert.equal(parsed.duplicates, 1); assert.deepEqual(parsed.invalid, ['invalid']);
  assert.throws(() => validateTestBatch(draft(11))); assert.throws(() => validateTestBatch({ ...draft(), subject: 'bad\r\nheader' }));
});
test('temporary SMTP personalizes and appends the compliant footer and signed headers without returning sender config', async () => withConfig(async () => {
  let sends = 0; const store = new MemoryStore();
  const response = await sendTemporaryBatch('owner', draft(1, false), { store, async send(message) {
    sends++; assert.equal(message.subject, 'Hi Owner0'); assert.match(String(message.text), /Hello Owner0/); assert.match(String(message.text), /Test Sender\n123 Test Street/);
    assert.match(String(message.text), /unsubscribe\?token=/); assert.ok(message.headers); return { accepted: ['owned0@example.com'] };
  } });
  assert.equal(sends, 1); assert.equal(response.results[0].status, 'sent');
  assert.ok(!JSON.stringify(response).includes('sender@example.com')); assert.ok(!JSON.stringify(response).includes('fixture-only-password'));
}));
test('temporary batches respect suppression and reread the kill switch before each recipient', async () => withConfig(async () => {
  const store = new MemoryStore(); await store.transact('owner', (state) => { state.suppression['owned0@example.com'] = { reason: 'Stop', at: Date.now() }; });
  let sends = 0;
  const response = await sendTemporaryBatch('owner', draft(3, false), { store, wait: async () => {}, async send() { sends++; await store.transact('owner', (state) => { state.killSwitch = true; }); return {}; } });
  assert.equal(sends, 1); assert.match(response.results[0].reason, /suppressed/); assert.match(response.results[2].reason, /kill switch/);
}));
test('temporary daily ledger enforces 50 per sender across batch requests', async () => withConfig(async () => {
  const store = new MemoryStore(); let sends = 0;
  for (let index = 0; index < 6; index++) {
    const response = await sendTemporaryBatch('owner', { ...draft(10, false), batchId: `batch-fixture-${index}` }, { store, wait: async () => {}, async send() { sends++; return {}; } });
    if (index === 5) assert.ok(response.results.every((r) => r.status === 'not-sent' && r.reason.includes('daily limit reached')));
  }
  assert.equal(sends, TEST_RULES.dailyCap);
}));
test('temporary failed or duplicate attempts never automatically retry or disclose SMTP errors', async () => withConfig(async () => {
  const store = new MemoryStore(); let sends = 0;
  const deps = { store, async send() { sends++; throw new Error('contains a private fixture password'); } };
  const first = await sendTemporaryBatch('owner', draft(1, false), deps);
  const second = await sendTemporaryBatch('owner', draft(1, false), deps);
  assert.equal(first.results[0].status, 'failed'); assert.equal(second.results[0].attempted, false); assert.equal(sends, 1); assert.ok(!JSON.stringify(first).includes('private fixture password'));
}));
test('temporary dry run simulates bounded gaps without invoking SMTP or modifying live sender quota', async () => withConfig(async () => {
  const store = new MemoryStore(); const waits: number[] = []; let sends = 0;
  const response = await sendTemporaryBatch('owner', draft(3), { store, random: () => .999, wait: async (ms) => { waits.push(ms); }, async send() { sends++; } });
  assert.equal(sends, 0); assert.deepEqual(waits, [8000, 8000]); assert.ok(response.results.every((r) => r.status === 'sent'));
  assert.ok([...store.records.keys()].every((key) => !key.startsWith('temporary-smtp:live')));
}));
