import type { WorkspaceStore } from './model';
import { connectedTokenResolver } from './google';
import { recalculateDue } from './schedule';

// Absence in search never proves a message was not sent. Only a positive match releases the hold.
export async function reconcileDeliveries(owner: string, store: WorkspaceStore,
  findSent?: (email: string, messageId: string) => Promise<string | undefined>) {
  const resolver = connectedTokenResolver(owner, store);
  const lookup = findSent || (async (email: string, messageId: string) => {
    const query = new URLSearchParams({ q: `in:sent rfc822msgid:${messageId.slice(1, -1)}`, maxResults: '1' });
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, {
      headers: { Authorization: `Bearer ${await resolver(email)}` }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Could not check the Gmail Sent folder. Reconnect the mailbox and try again.');
    return ((await response.json()) as { messages?: { id: string }[] }).messages?.[0]?.id;
  });
  const snapshot = await store.read(owner); let confirmed = 0;
  for (const attempt of Object.values(snapshot.attempts).filter((item) => item.status === 'unknown')) {
    const saved = snapshot.campaigns[attempt.campaignId];
    const mailbox = (saved?.state.simulationMode ? saved.state.mailboxes : snapshot.mailboxes).find((item) => item.id === attempt.mailboxId);
    if (!mailbox || !attempt.rfcMessageId || saved?.state.simulationMode) continue;
    const messageId = await lookup(mailbox.email, attempt.rfcMessageId);
    if (!messageId) continue;
    const resolved = await store.transact(owner, (workspace) => {
      const current = workspace.attempts[attempt.id]; if (current?.status !== 'unknown') return false;
      current.status = 'accepted'; current.messageId = messageId;
      const campaign = workspace.campaigns[current.campaignId];
      const recipient = campaign?.state.recipients.find((item) => item.id === current.recipientId);
      if (recipient) { recipient.status = 'sent'; recipient.sentAt = current.startedAt; recipient.messageId = messageId; }
      const sender = workspace.mailboxes.find((item) => item.id === current.mailboxId);
      if (sender) {
        sender.signalCheckAt = Date.now() + 120000; sender.nextSendAt = Date.now() + 120000;
        if (current.seedToken && current.seedEmail && campaign) {
          sender.pendingSeedProbes = [...(sender.pendingSeedProbes || []), { email: current.seedEmail, token: current.seedToken }];
          sender.recipientSendsSinceSeed = 0;
        }
      }
      const health = workspace.healthJobs.find((job) => job.id === current.campaignId);
      if (health) { health.status = 'waiting'; health.dueAt = Date.now() + 120000; }
      recalculateDue(workspace);
      return true;
    });
    if (resolved) confirmed++;
  }
  return { confirmed, remaining: Object.values((await store.read(owner)).attempts).filter((item) => item.status === 'unknown').length };
}
