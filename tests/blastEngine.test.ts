import test from 'node:test';
import assert from 'node:assert/strict';
import { BlastEngine, EngineState, inSendingWindow } from '../lib/services/blastEngine';
import { BLAST_CONFIG } from '../lib/config/blastConfig';
import type { BlastMailbox, Recipient, SendEmailParams, BounceEvent, SeedPlacement } from '../lib/types/blast';

const start = Date.parse('2026-10-16T05:30:00Z'); // 11:00 IST
function mailbox(id: string, domainId = 'd1', status: BlastMailbox['status'] = 'active'): BlastMailbox {
  return { id, domainId, email: `${id}@${domainId}.test`, displayName: id, status, dailyCap: 30,
    sentToday: 0, totalSent: 0, bouncesCount: 0, bounceRate: 0, recentSeedPlacements: [], assignedRecipientCount: 0 };
}
function recipient(id: string, mailboxId = 'a', status: Recipient['status'] = 'pending'): Recipient {
  return { id, mailboxId, email: `${id}@recipient.test`, status, ...(status === 'sent' ? { sentAt: start - 1 } : {}) };
}
function fixture() {
  let now = start;
  const sent: SendEmailParams[] = [];
  const suppressed = new Set<string>();
  let bounces: BounceEvent[] = [];
  let placement: SeedPlacement = 'inbox';
  let seedError = false;
  let suppressionError = false;
  let transportError = false;
  let replies: { email: string; isOptOut: boolean; body: string }[] = [];
  const probes: string[] = [];
  const engine = new BlastEngine({ async sendEmail(params) {
    if (transportError) throw new Error('Disconnected after dispatch');
    sent.push(params); return { success: true, messageId: `message-${sent.length}` };
  } }, { async getBounces() { const result = bounces; bounces = []; return result; }, async checkReplies() { return replies; } }, {
    async checkSeedPlacement(seedEmail, campaignId, mailboxId, token) {
      if (seedError) throw new Error('Missing probe');
      probes.push(token!); return { seedEmail, campaignId, mailboxId, placement, timestamp: now };
    },
  }, { now: () => now, random: () => 0, storage: {
    async isEmailSuppressed(email) { if (suppressionError) throw new Error('Database down'); return suppressed.has(email); },
    async addSuppression(email) { suppressed.add(email); }, async recordSeedResult() {},
  } });
  const state: EngineState = {
    campaign: { id: 'campaign', name: 'Test', subject: 'Hello', body: 'Message', senderName: 'Rahul',
      businessAddress: '123 Example Street', optOutText: 'Reply STOP to opt out', sendingWindow: { start: '10:00', end: '18:00', timeZone: 'Asia/Kolkata' },
      enableRamp: true, rampPercent: 15, status: 'running', totalRecipients: 1, sentCount: 0, bouncedCount: 0,
      pendingCount: 1, skippedCount: 0, createdAt: start, updatedAt: start, providerMode: 'simulation' },
    recipients: [recipient('r1')], mailboxes: [mailbox('a'), mailbox('spare', 'd2', 'spare')],
    domains: [{ id: 'd1', name: 'd1.test', status: 'active', flaggedMailboxCount: 0 }, { id: 'd2', name: 'd2.test', status: 'active', flaggedMailboxCount: 0 }],
    events: [], seedIndex: 0, delayedSignalMailboxes: [], simulationMode: true, simulationSpeedMultiplier: 1,
  };
  return { engine, state, sent, suppressed, probes, advance: (ms: number) => { now += ms; },
    bounce: (items: BounceEvent[]) => { bounces = items; }, placement: (value: SeedPlacement) => { placement = value; },
    seedError: () => { seedError = true; }, suppressionError: () => { suppressionError = true; },
    transportError: () => { transportError = true; }, replies: (items: typeof replies) => { replies = items; } };
}

test('second spam result pauses sender and activates spare; sent and in-flight records stay unchanged', () => {
  const f = fixture();
  f.state.recipients.push(recipient('sent', 'a', 'sent'), recipient('flight', 'a', 'sending'));
  const first = f.engine.injectSimulatedSpamPlacement('a', f.state);
  assert.equal(first.mailboxes[0].status, 'active');
  const second = f.engine.injectSimulatedSpamPlacement('a', first);
  assert.equal(second.mailboxes[0].status, 'paused');
  assert.equal(second.domains[0].status, 'watch');
  assert.equal(second.mailboxes[1].status, 'active');
  assert.equal(second.recipients[0].mailboxId, 'spare');
  assert.deepEqual(second.recipients.slice(1), f.state.recipients.slice(1));
  assert.equal(f.state.mailboxes[0].status, 'active');
  assert.ok(second.events.some((e) => e.title === 'Spare Mailbox Activated'));
});

test('only the last three results count; promotions does not count as spam', () => {
  const f = fixture();
  f.state.mailboxes[0].recentSeedPlacements = ['spam', 'inbox', 'promotions'];
  const next = f.engine.injectSimulatedSpamPlacement('a', f.state);
  assert.equal(next.mailboxes[0].status, 'active');
  assert.equal(next.mailboxes[1].status, 'spare');
});

test('two flagged senders pause the entire domain and reassign the third sender’s pending work', () => {
  const f = fixture();
  f.state.mailboxes.push(mailbox('b'), mailbox('c'));
  f.state.recipients.push(recipient('rb', 'b'), recipient('rc', 'c'));
  f.state.mailboxes[0].recentSeedPlacements = ['spam'];
  f.state.mailboxes[2].recentSeedPlacements = ['spam'];
  const first = f.engine.injectSimulatedSpamPlacement('a', f.state);
  const next = f.engine.injectSimulatedSpamPlacement('b', first);
  assert.equal(next.domains[0].status, 'paused');
  assert.ok(next.mailboxes.filter((m) => m.domainId === 'd1').every((m) => m.status === 'paused'));
  assert.ok(next.recipients.every((r) => r.mailboxId === 'spare'));
});

test('a spare on the paused domain is never activated', () => {
  const f = fixture();
  f.state.mailboxes[1].domainId = 'd1';
  f.state.domains[0].status = 'paused';
  const next = f.engine.injectSimulatedSpamPlacement('a', f.state);
  assert.equal(next.mailboxes[1].status, 'paused');
  assert.equal(next.campaign.status, 'alert_paused');
  assert.equal(next.recipients[0].status, 'pending');
});

test('failover reserves existing work and holds overflow instead of over-allocating the spare', () => {
  const f = fixture();
  f.state.mailboxes[0].status = 'paused';
  f.state.mailboxes[1].dailyCap = 2;
  f.state.recipients = Array.from({ length: 5 }, (_, i) => recipient(`r${i}`));
  const next = f.engine.reallocateUnsentRecipients(f.state.recipients, f.state.mailboxes, [], 'campaign', f.state.domains);
  assert.equal(next.updatedRecipients.filter((r) => r.mailboxId === 'spare').length, 2);
  assert.equal(next.updatedRecipients.filter((r) => r.mailboxId === 'a').length, 3);
  assert.equal(next.updatedMailboxes[1].assignedRecipientCount, 2);
});

test('30-second minimum gap is enforced across ticks; sends include footer, reply address, and message ID', async () => {
  const f = fixture(); f.state.recipients.push(recipient('r2'));
  let next = (await f.engine.processMailboxBatch('a', f.state)).updatedState;
  next = (await f.engine.processMailboxBatch('a', next)).updatedState;
  assert.equal(f.sent.length, 1);
  f.advance(30000);
  next = (await f.engine.processMailboxBatch('a', next)).updatedState;
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0].replyTo, 'a@d1.test');
  assert.match(f.sent[0].body, /123 Example Street/);
  assert.match(f.sent[0].body, /STOP/);
  assert.equal(next.recipients[0].messageId, 'message-1');
});

test('a full batch waits two minutes for signal evaluation before any next send', async () => {
  const f = fixture(); f.state.recipients = Array.from({ length: 12 }, (_, i) => recipient(`r${i}`));
  let next = f.state;
  for (let i = 0; i < 10; i++) { next = (await f.engine.processMailboxBatch('a', next)).updatedState; if (i < 9) f.advance(30000); }
  assert.equal(f.sent.length, 10);
  assert.ok(next.mailboxes[0].signalCheckAt);
  f.advance(119000);
  next = (await f.engine.processMailboxBatch('a', next)).updatedState;
  assert.equal(f.sent.length, 10);
  f.advance(1000);
  next = (await f.engine.processMailboxBatch('a', next)).updatedState;
  assert.equal(f.sent.length, 10); // evaluation is a separate operation
  assert.equal(next.mailboxes[0].signalCheckAt, undefined);
  next = (await f.engine.processMailboxBatch('a', next)).updatedState;
  assert.equal(f.sent.length, 11);
  assert.equal(f.sent[10].toEmail, BLAST_CONFIG.DEFAULT_SEEDS[0]);
  assert.ok(f.sent[10].seedToken);
  assert.equal(next.mailboxes[0].sentToday, 11);
});

test('final batch gets evaluated before campaign completion', async () => {
  const f = fixture();
  let next = (await f.engine.processMailboxBatch('a', f.state)).updatedState;
  assert.equal(next.campaign.status, 'running');
  f.advance(120000);
  next = (await f.engine.processMailboxBatch('a', next)).updatedState;
  assert.equal(next.campaign.status, 'completed');
});

test('engine clamps a forged daily cap to 50 and will not send beyond it', async () => {
  const f = fixture(); f.state.mailboxes[0].dailyCap = 999; f.state.mailboxes[0].sentToday = 50;
  const next = (await f.engine.processMailboxBatch('a', f.state)).updatedState;
  assert.equal(f.sent.length, 0); assert.equal(next.mailboxes[0].dailyCap, 50);
});

test('paused campaign cannot be sent by manual tick', async () => {
  const f = fixture(); f.state.campaign.status = 'paused';
  await f.engine.processMailboxBatch('a', f.state); assert.equal(f.sent.length, 0);
});

test('10am–6pm window is evaluated in the campaign timezone', async () => {
  const f = fixture();
  assert.equal(inSendingWindow(f.state.campaign, Date.parse('2026-10-16T04:29:00Z')), false);
  assert.equal(inSendingWindow(f.state.campaign, Date.parse('2026-10-16T04:30:00Z')), true);
  assert.equal(inSendingWindow(f.state.campaign, Date.parse('2026-10-16T12:30:00Z')), false);
  f.state.simulationMode = false; f.advance(8 * 3600000);
  await f.engine.processMailboxBatch('a', f.state); assert.equal(f.sent.length, 0);
});

test('bounce threshold is strictly above 3% and requires at least 50 sends', async () => {
  const f = fixture(); const m = f.state.mailboxes[0];
  m.totalSent = 49; m.bouncesCount = 2;
  let next = (await f.engine.processMailboxBatch('a', f.state)).updatedState;
  next = (await f.engine.processMailboxBatch('a', next)).updatedState;
  assert.equal(next.mailboxes[0].status, 'paused'); // 50 lifetime sends reached
  const g = fixture(); g.state.mailboxes[0].totalSent = 100; g.state.mailboxes[0].bouncesCount = 3;
  const unchanged = (await g.engine.processMailboxBatch('a', g.state)).updatedState;
  assert.equal(unchanged.mailboxes[0].status, 'active');
});

test('cooldown blocks early resume, then restarts at 8/day with a fresh health window', () => {
  const f = fixture(); let next = f.engine.injectSimulatedSpamPlacement('a', f.state);
  next = f.engine.injectSimulatedSpamPlacement('a', next);
  assert.equal(f.engine.resumeMailbox('a', next).mailboxes[0].status, 'paused');
  f.advance(48 * 3600000);
  next = f.engine.resumeMailbox('a', next);
  assert.equal(next.mailboxes[0].status, 'active'); assert.equal(next.mailboxes[0].dailyCap, 8);
  assert.deepEqual(next.mailboxes[0].recentSeedPlacements, []);
});

test('a healthy new day resets usage and ramps by 15%, without crossing 50', async () => {
  const f = fixture(); f.state.mailboxes[0].dailyCap = 49; f.state.mailboxes[0].sentToday = 20; f.state.mailboxes[0].dailyResetDate = '2026-10-16';
  f.advance(24 * 3600000);
  const next = (await f.engine.processMailboxBatch('a', f.state)).updatedState;
  assert.equal(next.mailboxes[0].dailyCap, 50); assert.equal(next.mailboxes[0].sentToday, 1);
});

test('suppressed recipients are skipped and a failed suppression lookup stops sending', async () => {
  const f = fixture(); f.suppressed.add('r1@recipient.test');
  const next = (await f.engine.processMailboxBatch('a', f.state)).updatedState;
  assert.equal(next.recipients[0].status, 'skipped'); assert.equal(f.sent.length, 0);
  const g = fixture(); g.suppressionError();
  const stopped = (await g.engine.processMailboxBatch('a', g.state)).updatedState;
  assert.equal(stopped.campaign.status, 'alert_paused'); assert.equal(g.sent.length, 0);
});

test('human replies are suppressed and pending follow-up is skipped', async () => {
  const f = fixture(); f.state.mailboxes[0].signalCheckAt = start;
  f.replies([{ email: 'r1@recipient.test', isOptOut: true, body: 'STOP' }]);
  const next = (await f.engine.processMailboxBatch('a', f.state)).updatedState;
  assert.ok(f.suppressed.has('r1@recipient.test')); assert.equal(next.recipients[0].status, 'skipped');
});

test('missing seed results do not become successful inbox placements', async () => {
  const f = fixture(); f.seedError(); f.state.mailboxes[0].signalCheckAt = start;
  f.state.mailboxes[0].pendingSeedProbes = [{ email: 'seed@test.invalid', token: 'probe-1' }];
  const next = (await f.engine.processMailboxBatch('a', f.state)).updatedState;
  assert.deepEqual(next.mailboxes[0].recentSeedPlacements, []);
  assert.ok(next.delayedSignalMailboxes.includes('a'));
  assert.equal(next.campaign.status, 'alert_paused');
});

test('seed lookup receives the exact token from the outgoing probe', async () => {
  const f = fixture(); f.state.mailboxes[0].signalCheckAt = start;
  f.state.mailboxes[0].pendingSeedProbes = [{ email: 'seed@test.invalid', token: 'probe-123' }];
  await f.engine.processMailboxBatch('a', f.state);
  assert.deepEqual(f.probes, ['probe-123']);
});

test('uncertain transport outcome pauses instead of retrying or transferring the recipient', async () => {
  const f = fixture(); f.transportError();
  const next = (await f.engine.processMailboxBatch('a', f.state)).updatedState;
  assert.equal(next.campaign.status, 'alert_paused'); assert.equal(next.recipients[0].status, 'sending');
  assert.equal(next.recipients[0].mailboxId, 'a');
});

test('campaign state can round-trip through JSON and still execute', async () => {
  const f = fixture(); const restored: EngineState = JSON.parse(JSON.stringify(f.state));
  const next = (await f.engine.processMailboxBatch('a', restored)).updatedState;
  assert.equal(next.recipients[0].status, 'sent'); assert.ok(Array.isArray(next.delayedSignalMailboxes));
});

test('delayed signals can recover while sending remains paused for manual review', async () => {
  const f = fixture();
  const delayed = f.engine.injectDelayedSignalEvent('a', f.state);
  assert.equal(delayed.campaign.status, 'alert_paused');
  f.advance(120000);
  const recovered = (await f.engine.processMailboxBatch('a', delayed)).updatedState;
  assert.deepEqual(recovered.delayedSignalMailboxes, []);
  assert.equal(recovered.campaign.status, 'alert_paused');
  assert.equal(f.sent.length, 0);
});

test('live timing ignores the simulation speed setting', async () => {
  const f = fixture(); f.state.simulationMode = false; f.state.simulationSpeedMultiplier = 120;
  f.state.recipients.push(recipient('r2'));
  const prior = [...BLAST_CONFIG.LIVE_SEEDS]; BLAST_CONFIG.LIVE_SEEDS.push('seed@test.invalid');
  try {
    let next = (await f.engine.processMailboxBatch('a', f.state)).updatedState;
    f.advance(1000);
    next = (await f.engine.processMailboxBatch('a', next)).updatedState;
    assert.equal(f.sent.length, 1);
    f.advance(29000);
    await f.engine.processMailboxBatch('a', next);
    assert.equal(f.sent.length, 2);
  } finally { BLAST_CONFIG.LIVE_SEEDS.splice(0, BLAST_CONFIG.LIVE_SEEDS.length, ...prior); }
});
