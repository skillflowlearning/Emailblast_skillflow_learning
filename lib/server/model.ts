import type { BlastDomain, BlastMailbox } from '../types/blast';
import type { EngineState } from '../services/blastEngine';

export interface DomainRecord extends BlastDomain {
  registeredDomain: string;
  verificationToken: string;
  verifiedAt?: number;
  pausedAt?: number;
  cooldownUntil?: number;
  dns?: { checkedAt: number; ownership: boolean; mx: boolean; spf: boolean; dkim: boolean; dmarc: boolean; issues: string[] };
  dkimSelector: string;
  dailyBudget: number;
}
export interface MailboxRecord extends BlastMailbox {
  connectionId: string;
  health?: { status: 'unchecked' | 'checking' | 'healthy' | 'unhealthy'; checkedAt?: number; detail?: string; placement?: string };
  lastControlAt?: number;
}
export interface ConnectionRecord {
  id: string; email: string; role: 'sender' | 'seed'; refreshToken: string;
  scopes: string[]; connectedAt: number; revoked?: boolean;
}
export interface HealthJob {
  id: string; mailboxId: string; seedEmail: string; token: string;
  dueAt: number; attempts: number; status: 'queued' | 'sending' | 'waiting' | 'done' | 'failed';
}
export interface SavedCampaign {
  state: EngineState; controlVersion: number; createdAt: number; nextDueAt: number;
}
export interface DeliveryAttempt {
  id: string; campaignId: string; recipientId?: string; mailboxId: string;
  status: 'dispatching' | 'accepted' | 'unknown'; startedAt: number; messageId?: string;
  rfcMessageId?: string;
  seedToken?: string; seedEmail?: string;
}
export interface Workspace {
  ownerId: string; version: number; nextDueAt: number; killSwitch: boolean;
  domains: DomainRecord[]; mailboxes: MailboxRecord[]; connections: ConnectionRecord[];
  campaigns: Record<string, SavedCampaign>; suppression: Record<string, { reason: string; at: number }>;
  healthJobs: HealthJob[]; attempts: Record<string, DeliveryAttempt>;
  lease?: { token: string; until: number };
  workerHeartbeat?: number;
}
export const NEVER = 8640000000000000;
export function emptyWorkspace(ownerId: string): Workspace {
  return { ownerId, version: 0, nextDueAt: NEVER, killSwitch: false, domains: [], mailboxes: [],
    connections: [], campaigns: {}, suppression: {}, healthJobs: [], attempts: {} };
}

export interface WorkspaceStore {
  read(owner: string): Promise<Workspace>;
  transact<T>(owner: string, change: (workspace: Workspace) => T): Promise<T>;
  dueOwners(now: number): Promise<string[]>;
}

export function publicWorkspace(workspace: Workspace) {
  return {
    domains: workspace.domains, mailboxes: workspace.mailboxes,
    connections: workspace.connections.map(({ id, email, role, connectedAt, revoked }) => ({ id, email, role, connectedAt, revoked })),
    killSwitch: workspace.killSwitch, workerHeartbeat: workspace.workerHeartbeat,
    uncertainDeliveries: Object.values(workspace.attempts).filter((attempt) => attempt.status === 'unknown').map(({ id, mailboxId, startedAt }) => ({ id, mailboxId, startedAt })),
    healthJobs: workspace.healthJobs.map(({ id, mailboxId, status, dueAt }) => ({ id, mailboxId, status, dueAt })),
  };
}
