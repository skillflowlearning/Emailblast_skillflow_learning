import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { FileWorkspaceStore, packWorkspace } from '../lib/server/store';
import { BackgroundWorker } from '../lib/server/worker';
import { createCampaign, campaignState, controlCampaign } from '../lib/server/campaigns';
import { emptyWorkspace } from '../lib/server/model';
import { recalculateDue } from '../lib/server/schedule';
import { reconcileDeliveries } from '../lib/server/recovery';
import type { MailProvider } from '../lib/types/blast';

const draft = (count = 3) => ({ name: 'Background test', subject: 'Hello', body: 'Test body', senderName: 'Demo', businessAddress: '123 Example Street',
  optOutText: 'Reply STOP', providerMode: 'simulation', sendingWindow: { start: '10:00', end: '18:00' },
  recipients: Array.from({ length: count }, (_, i) => ({ email: `test${i}@example.com` })) });

async function fixture(run: (store: FileWorkspaceStore, directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mailflow-test-'));
  try { await run(new FileWorkspaceStore(directory), directory); }
  finally {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('mailflow-test-')) throw new Error('Unexpected test cleanup path');
    await rm(resolved, { recursive: true, force: true });
  }
}

test('campaigns persist across repository instances with all 10,000 recipients', async () => {
  await fixture(async (store, directory) => {
    const id = await store.transact('owner-a', (workspace) => createCampaign(workspace, draft(10000)));
    const reopened = await new FileWorkspaceStore(directory).read('owner-a');
    assert.equal(reopened.campaigns[id].state.recipients.length, 10000);
    const chunks = packWorkspace(reopened);
    assert.deepEqual(JSON.parse(chunks.join('')), reopened);
    assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk) < 1000000));
  });
});

test('workspace data is isolated by owner', async () => {
  await fixture(async (store) => {
    await store.transact('owner-a', (workspace) => createCampaign(workspace, draft()));
    assert.deepEqual((await store.read('owner-b')).campaigns, {});
  });
});

test('Firestore chunks preserve Unicode when a character crosses the byte-encoding boundary', () => {
  const workspace = emptyWorkspace('');
  const prefix = JSON.stringify(workspace).indexOf('"ownerId":"') + '"ownerId":"'.length;
  workspace.ownerId = 'a'.repeat(49999 - prefix) + '😀' + 'z';
  const chunks = packWorkspace(workspace);
  assert.ok(chunks.length > 1);
  assert.deepEqual(JSON.parse(chunks.map((chunk) => Buffer.from(chunk).toString('utf8')).join('')), workspace);
});

test('two independent worker instances cannot send the same recipient concurrently', async () => {
  await fixture(async (store, directory) => {
    await store.transact('owner', (workspace) => createCampaign(workspace, draft(1)));
    let sends = 0;
    const provider: MailProvider = { async sendEmail() { sends++; await new Promise((resolve) => setTimeout(resolve, 100)); return { success: true, messageId: 'once' }; } };
    await Promise.all([new BackgroundWorker(store, provider).processOwner('owner'), new BackgroundWorker(new FileWorkspaceStore(directory), provider).processOwner('owner')]);
    assert.equal(sends, 1);
    const workspace = await store.read('owner');
    assert.equal(Object.values(workspace.attempts)[0].status, 'accepted');
    assert.equal(Object.values(workspace.campaigns)[0].state.recipients[0].status, 'sent');
  });
});

test('an interrupted dispatch is held for review after a worker restart', async () => {
  await fixture(async (store) => {
    const id = await store.transact('owner', (workspace) => {
      const id = createCampaign(workspace, draft(1)); const r = workspace.campaigns[id].state.recipients[0]; r.status = 'sending';
      workspace.attempts.test = { id: 'test', campaignId: id, mailboxId: r.mailboxId!, recipientId: r.id, status: 'dispatching', startedAt: Date.now() - 600000 };
      workspace.lease = { token: 'dead-worker', until: Date.now() - 1 }; return id;
    });
    let sends = 0; await new BackgroundWorker(store, { async sendEmail() { sends++; return { success: true, messageId: 'bad' }; } }).processOwner('owner');
    const workspace = await store.read('owner');
    assert.equal(sends, 0); assert.equal(workspace.attempts.test.status, 'unknown');
    assert.equal(workspace.campaigns[id].state.campaign.status, 'alert_paused');
    assert.throws(() => controlCampaign(workspace, id, 'resume'), /uncertain send/);
  });
});

test('durable emergency stop survives restart and blocks the worker', async () => {
  await fixture(async (store, directory) => {
    await store.transact('owner', (workspace) => { createCampaign(workspace, draft()); workspace.killSwitch = true; recalculateDue(workspace); });
    let sends = 0; const reopened = new FileWorkspaceStore(directory);
    await new BackgroundWorker(reopened, { async sendEmail() { sends++; return { success: true, messageId: 'bad' }; } }).processOwner('owner');
    assert.equal((await reopened.read('owner')).killSwitch, true); assert.equal(sends, 0);
  });
});

test('background work progresses without browser state and is visible after reopen', async () => {
  await fixture(async (store, directory) => {
    const id = await store.transact('owner', (workspace) => createCampaign(workspace, draft(1)));
    await new BackgroundWorker(store).processOwner('owner');
    const state = campaignState(await new FileWorkspaceStore(directory).read('owner'), id);
    assert.equal(state.campaign.sentCount, 1); assert.equal(state.recipients[0].status, 'sent');
  });
});

test('no due operation does not create a new delivery attempt', async () => {
  await fixture(async (store) => {
    await store.transact('owner', (workspace) => createCampaign(workspace, draft(1)));
    const worker = new BackgroundWorker(store); await worker.processOwner('owner');
    await worker.processOwner('owner');
    assert.equal(Object.keys((await store.read('owner')).attempts).length, 1);
  });
});

test('a paused mailbox transfers pending recipients through persisted controls', async () => {
  await fixture(async (store) => {
    const id = await store.transact('owner', (workspace) => createCampaign(workspace, draft(90)));
    await store.transact('owner', (workspace) => { controlCampaign(workspace, id, 'inject-spam', 'mbx-1'); controlCampaign(workspace, id, 'inject-spam', 'mbx-1'); });
    const state = campaignState(await store.read('owner'), id);
    assert.equal(state.mailboxes.find((m) => m.id === 'mbx-1')?.status, 'paused');
    assert.equal(state.mailboxes.find((m) => m.id === 'mbx-spare')?.status, 'active');
    assert.equal(state.recipients.filter((r) => r.mailboxId === 'mbx-spare').length, 10);
  });
});

test('local filesystem transaction recovers a lock owned by a terminated process', async () => {
  await fixture(async (store, directory) => {
    const key = createHash('sha256').update('owner').digest('hex');
    await writeFile(path.join(directory, `${key}.json.lock`), JSON.stringify({ pid: 2147483647 }));
    await store.transact('owner', (workspace) => { workspace.killSwitch = true; });
    assert.equal((await store.read('owner')).killSwitch, true);
  });
});

test('health test waits for the matching seed result before activation is allowed', async () => {
  await fixture(async (store) => {
    await store.transact('owner', (workspace) => {
      workspace.domains.push({ id: 'example.org', name: 'example.org', registeredDomain: 'example.org', verificationToken: 'test', dkimSelector: 'google', dailyBudget: 90, status: 'active', flaggedMailboxCount: 0 });
      workspace.mailboxes.push({ id: 'sender', email: 'sender@example.org', connectionId: 'c', displayName: 'Sender', domainId: 'example.org', dailyCap: 30, sentToday: 0, totalSent: 0, bouncesCount: 0, bounceRate: 0, recentSeedPlacements: [], assignedRecipientCount: 0, status: 'paused', health: { status: 'checking' } });
      workspace.healthJobs.push({ id: 'health', mailboxId: 'sender', seedEmail: 'seed@example.org', token: 'exact-token', dueAt: Date.now(), attempts: 0, status: 'queued' }); recalculateDue(workspace);
    });
    let sent = 0; let checked = 0;
    const worker = new BackgroundWorker(store, undefined, {
      provider: { async sendEmail() { sent++; return { success: true, messageId: 'probe' }; } },
      checker: { async checkSeedPlacement(seedEmail, campaignId, mailboxId, token) { checked++; assert.equal(token, 'exact-token'); return { seedEmail, campaignId, mailboxId, placement: 'inbox', timestamp: Date.now() }; } },
    });
    await worker.processOwner('owner');
    let workspace = await store.read('owner');
    assert.equal(sent, 1); assert.equal(checked, 0); assert.equal(workspace.mailboxes[0].health?.status, 'checking');
    assert.ok(workspace.healthJobs[0].dueAt > Date.now() + 100000);
    await store.transact('owner', (workspace) => { workspace.healthJobs[0].dueAt = Date.now(); recalculateDue(workspace); });
    await worker.processOwner('owner'); workspace = await store.read('owner');
    assert.equal(checked, 1); assert.equal(workspace.mailboxes[0].health?.status, 'healthy');
    assert.equal(workspace.mailboxes[0].status, 'paused'); // Health alone does not silently resume sending.
  });
});

test('a pause during provider dispatch survives the worker commit', async () => {
  await fixture(async (store) => {
    const id = await store.transact('owner', (workspace) => createCampaign(workspace, draft(3)));
    await new BackgroundWorker(store, { async sendEmail() {
      await store.transact('owner', (workspace) => controlCampaign(workspace, id, 'pause'));
      return { success: true, messageId: 'already-in-flight' };
    } }).processOwner('owner');
    const saved = (await store.read('owner')).campaigns[id];
    assert.equal(saved.state.campaign.status, 'paused');
    assert.equal(saved.state.recipients.filter((r) => r.status === 'sent').length, 1);
    assert.equal(saved.state.recipients.filter((r) => r.status === 'pending').length, 2);
  });
});

test('a network failure creates an immediate durable uncertainty hold', async () => {
  await fixture(async (store) => {
    await store.transact('owner', (workspace) => createCampaign(workspace, draft(1)));
    let sends = 0;
    const worker = new BackgroundWorker(store, { async sendEmail() { sends++; throw new Error('Network interrupted'); } });
    await worker.processOwner('owner'); await worker.processOwner('owner');
    const workspace = await store.read('owner');
    assert.equal(sends, 1);
    assert.equal(Object.values(workspace.attempts)[0].status, 'unknown');
    assert.ok(Object.values(workspace.attempts)[0].rfcMessageId?.startsWith('<mailflow-'));
    assert.equal(Object.values(workspace.campaigns)[0].state.mailboxes.reduce((sum, mailbox) => sum + mailbox.sentToday, 0), 1);
  });
});

test('recovery confirms only a positive Gmail Sent match and never retries missing messages', async () => {
  await fixture(async (store) => {
    const id = await store.transact('owner', (workspace) => {
      const id = createCampaign(workspace, draft(1)); const saved = workspace.campaigns[id];
      saved.state.simulationMode = false; saved.state.campaign.status = 'alert_paused';
      const recipient = saved.state.recipients[0]; recipient.status = 'sending';
      workspace.mailboxes = saved.state.mailboxes.map((m) => ({ ...m, connectionId: 'c' }));
      workspace.attempts.test = { id: 'test', campaignId: id, mailboxId: recipient.mailboxId!, recipientId: recipient.id, status: 'unknown', startedAt: Date.now(), rfcMessageId: '<unique@example.org>' };
      return id;
    });
    assert.deepEqual(await reconcileDeliveries('owner', store, async () => undefined), { confirmed: 0, remaining: 1 });
    assert.equal((await store.read('owner')).campaigns[id].state.recipients[0].status, 'sending');
    assert.deepEqual(await reconcileDeliveries('owner', store, async (_email, messageId) => { assert.equal(messageId, '<unique@example.org>'); return 'gmail-confirmed'; }), { confirmed: 1, remaining: 0 });
    assert.equal((await store.read('owner')).campaigns[id].state.recipients[0].messageId, 'gmail-confirmed');
    assert.equal((await store.read('owner')).campaigns[id].state.campaign.status, 'alert_paused');
  });
});

test('pausing the canonical live mailbox schedules immediate failover evaluation', () => {
  const workspace = emptyWorkspace('owner'); const id = createCampaign(workspace, draft(1));
  const state = workspace.campaigns[id].state; state.simulationMode = false;
  workspace.mailboxes = state.mailboxes.map((m) => ({ ...m, status: 'paused', connectionId: 'c' }));
  const now = Date.now(); recalculateDue(workspace, now);
  assert.equal(workspace.nextDueAt, now);
});
