import { inSendingWindow, sendingDate } from '../services/blastEngine';
import type { Campaign } from '../types/blast';
import { NEVER, Workspace } from './model';
import { domainCapacity } from './domains';

export function nextWindow(campaign: Campaign, now: number, tomorrow = false) {
  const today = sendingDate(campaign, now);
  for (let minute = Math.ceil(now / 60000) * 60000; minute <= now + 49 * 3600000; minute += 60000) {
    if ((!tomorrow || sendingDate(campaign, minute) !== today) && inSendingWindow(campaign, minute)) return minute;
  }
  return NEVER;
}
export function recalculateDue(workspace: Workspace, now = Date.now()) {
  let due = NEVER;
  if (workspace.killSwitch) { workspace.nextDueAt = NEVER; return; }
  for (const job of workspace.healthJobs) if (job.status === 'queued' || job.status === 'waiting') due = Math.min(due, job.dueAt);
  for (const saved of Object.values(workspace.campaigns)) {
    const { state } = saved; let campaignDue = NEVER;
    if (!['running', 'alert_paused'].includes(state.campaign.status)) { saved.nextDueAt = NEVER; continue; }
    for (const mailbox of state.mailboxes) {
      const current = state.simulationMode ? mailbox : workspace.mailboxes.find((m) => m.id === mailbox.id);
      const domain = state.simulationMode ? state.domains.find((d) => d.id === mailbox.domainId) : workspace.domains.find((d) => d.id === mailbox.domainId);
      if (!current || current.status !== 'active' || domain?.status === 'paused') continue;
      if (current.signalCheckAt) { campaignDue = Math.min(campaignDue, current.signalCheckAt); continue; }
      if (state.campaign.status !== 'running' || !state.recipients.some((r) => r.status === 'pending' && r.mailboxId === mailbox.id)) continue;
      const date = sendingDate(state.campaign, now);
      const used = current.dailyResetDate === date ? current.sentToday : 0;
      const capacity = domainCapacity(workspace, current.domainId, date);
      if (used >= Math.min(50, current.dailyCap) || (!state.simulationMode && domain && capacity.used >= capacity.limit)) {
        campaignDue = Math.min(campaignDue, nextWindow(state.campaign, now, true)); continue;
      }
      const sendAt = Math.max(now, current.nextSendAt || 0);
      campaignDue = Math.min(campaignDue, state.simulationMode || inSendingWindow(state.campaign, sendAt) ? sendAt : nextWindow(state.campaign, sendAt));
    }
    // One evaluation is needed to redistribute pending work after a control action.
    if (state.campaign.status === 'running' && state.recipients.some((r) => r.status === 'pending' && !state.mailboxes.some((m) => {
      const current = state.simulationMode ? m : workspace.mailboxes.find((box) => box.id === m.id);
      const domain = state.simulationMode ? state.domains.find((d) => d.id === m.domainId) : workspace.domains.find((d) => d.id === m.domainId);
      return m.id === r.mailboxId && current?.status === 'active' && domain?.status !== 'paused';
    }))) campaignDue = Math.min(campaignDue, now);
    saved.nextDueAt = campaignDue; due = Math.min(due, campaignDue);
  }
  workspace.nextDueAt = workspace.lease && workspace.lease.until > now ? Math.max(due, workspace.lease.until) : due;
}
