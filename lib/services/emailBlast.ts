import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

export interface Domain {
  id: string;
  name: string;
  dailyLimit: number;
  sent: number;
  status: 'active' | 'paused';
}

export interface BlastConfig {
  listId: string;
  templateId: string;
  domains: Domain[];
  scheduledAt: Date;
  senderName: string;
  businessAddress: string;
}

/**
 * TODO: Replace this stub with real sending logic via Google Workspace Gmail API
 * or authenticated SMTP via Nodemailer as fallback.
 * Always check the suppression list before sending to any address.
 */
export async function sendBatch(
  recipients: string[],
  template: { subject: string; body: string },
  domain: Domain,
  senderName: string,
  businessAddress: string
): Promise<{ sent: number; suppressed: number }> {
  // STUB: Simulates sending without actual email delivery
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log(`[STUB] Would send ${recipients.length} emails via ${domain.name}`);
  return { sent: recipients.length, suppressed: 0 };
}

export function splitRecipientsAcrossDomains(
  recipients: string[],
  domains: Domain[]
): Map<string, string[]> {
  const allocation = new Map<string, string[]>();
  let idx = 0;
  for (const domain of domains) {
    if (domain.status === 'paused') continue;
    const available = domain.dailyLimit - domain.sent;
    if (available <= 0) continue;
    const batch = recipients.slice(idx, idx + available);
    if (batch.length > 0) allocation.set(domain.id, batch);
    idx += batch.length;
    if (idx >= recipients.length) break;
  }
  return allocation;
}
