import { randomBytes } from 'node:crypto';
import { resolveMx, resolveTxt } from 'node:dns/promises';
import { domainToASCII } from 'node:url';
import { getDomain } from 'tldts';
import type { DomainRecord, Workspace } from './model';

export function normalizeDomain(value: unknown) {
  if (typeof value !== 'string') throw new Error('Enter a sending domain.');
  const name = domainToASCII(value.trim().toLowerCase().replace(/\.$/, ''));
  if (name.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(name)) throw new Error('Enter a domain name without https:// or a path.');
  const registeredDomain = getDomain(name, { allowPrivateDomains: true });
  if (!registeredDomain) throw new Error('A publicly registered sending domain is required.');
  return { name, registeredDomain };
}
export function newDomain(value: unknown): DomainRecord {
  const domain = normalizeDomain(value);
  return { ...domain, id: domain.name, status: 'active', flaggedMailboxCount: 0, verificationToken: randomBytes(24).toString('hex'), dkimSelector: 'google', dailyBudget: 90 };
}
export function domainCapacity(workspace: Workspace, domainId: string, date: string) {
  const domain = workspace.domains.find((item) => item.id === domainId);
  const related = workspace.domains.filter((item) => item.registeredDomain === domain?.registeredDomain);
  return {
    used: workspace.mailboxes.filter((mailbox) => related.some((item) => item.id === mailbox.domainId) && mailbox.dailyResetDate === date).reduce((sum, mailbox) => sum + mailbox.sentToday, 0),
    limit: Math.min(150, ...related.map((item) => item.dailyBudget)),
  };
}
const txt = async (name: string) => resolveTxt(name).then((rows) => rows.map((row) => row.join(''))).catch(() => [] as string[]);
export async function checkDomain(domain: DomainRecord) {
  const [ownershipRecords, mxRecords, spfRecords, dkimRecords, dmarcRecords] = await Promise.all([
    txt(`_mailflow-verify.${domain.name}`), resolveMx(domain.name).catch(() => []), txt(domain.name),
    txt(`${domain.dkimSelector}._domainkey.${domain.name}`), txt(`_dmarc.${domain.name}`),
  ]);
  const ownership = ownershipRecords.includes(`mailflow=${domain.verificationToken}`);
  const spf = spfRecords.filter((row) => /^v=spf1\s/i.test(row)).length === 1
    && spfRecords.some((row) => /^v=spf1\s/i.test(row) && /include:_spf\.google\.com(?:\s|$)/i.test(row));
  const dkim = dkimRecords.some((row) => /(?:^|;)\s*p\s*=\s*[A-Za-z0-9+/]{20,}/i.test(row));
  const dmarc = dmarcRecords.filter((row) => /^v=DMARC1;/i.test(row)).length === 1
    && dmarcRecords.some((row) => /^v=DMARC1;/i.test(row) && /(?:^|;)\s*p=(none|quarantine|reject)(?:;|$)/i.test(row));
  const mx = mxRecords.length > 0;
  return { checkedAt: Date.now(), ownership, mx, spf, dkim, dmarc,
    issues: [!ownership && 'Ownership TXT record missing', !mx && 'MX records missing', !spf && 'A single SPF record including Google Workspace is required', !dkim && 'DKIM public key not found for this selector', !dmarc && 'Valid DMARC record missing'].filter(Boolean) as string[] };
}
export function launchIssues(workspace: Workspace, mailboxIds: string[], now = Date.now()): string[] {
  const senders = workspace.mailboxes.filter((m) => mailboxIds.includes(m.id) && m.status === 'active');
  const domains = workspace.domains.filter((domain) => senders.some((m) => m.domainId === domain.id));
  const issues: string[] = [];
  if (new Set(domains.map((d) => d.registeredDomain)).size < 2) issues.push('Automatic domain failover requires at least two different verified registered sending domains.');
  if (!senders.length) issues.push('Connect and health-check at least one active sending mailbox.');
  if (!workspace.mailboxes.some((m) => m.status === 'spare' && m.health?.status === 'healthy' && now - (m.health.checkedAt || 0) < 86400000
    && workspace.domains.some((d) => d.id === m.domainId && d.verifiedAt && d.dns && !d.dns.issues.length && now - d.dns.checkedAt < 86400000 && d.status !== 'paused')
    && workspace.connections.some((c) => c.id === m.connectionId && !c.revoked))) issues.push('Keep at least one connected, healthy spare mailbox available.');
  for (const domain of domains) if (!domain.verifiedAt || domain.dns?.issues.length || !domain.dns || now - domain.dns.checkedAt > 86400000 || domain.status === 'paused') issues.push(`${domain.name}: fresh ownership, MX, SPF, DKIM, and DMARC checks are required.`);
  for (const mailbox of senders) if (mailbox.health?.status !== 'healthy' || now - (mailbox.health.checkedAt || 0) > 86400000
    || !workspace.connections.some((c) => c.id === mailbox.connectionId && !c.revoked)) issues.push(`${mailbox.email}: connect Google Workspace and pass a fresh seed health check.`);
  if (!workspace.connections.some((c) => c.role === 'seed' && !c.revoked && !senders.some((m) => m.email === c.email))) issues.push('Connect a separate Google seed inbox you own.');
  return [...new Set(issues)];
}
