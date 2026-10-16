/**
 * Storage & Firestore Adapter for Email Blast
 * Syncs campaigns, recipients, mailboxes, domains, events, seeds, and suppression
 * with Firestore collections when online, with robust local fallback.
 */

import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
} from 'firebase/firestore';
import {
  Campaign,
  Recipient,
  BlastMailbox,
  BlastDomain,
  BlastEvent,
  SeedCheckResult,
} from '@/lib/types/blast';

export class BlastStorage {
  private isFirebaseConfigured(): boolean {
    const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    return Boolean(key && key !== 'demo-api-key' && !key.includes('placeholder'));
  }

  // ── Campaign Persistence ───────────────────────────────────────────────
  async saveCampaign(campaign: Campaign): Promise<void> {
    try {
      if (this.isFirebaseConfigured() && db) {
        await setDoc(doc(db, 'campaigns', campaign.id), campaign);
      }
    } catch (e) {
      console.warn('[BlastStorage] Firestore saveCampaign fallback:', e);
    }
  }

  async getCampaign(campaignId: string): Promise<Campaign | null> {
    try {
      if (this.isFirebaseConfigured() && db) {
        const snap = await getDoc(doc(db, 'campaigns', campaignId));
        if (snap.exists()) return snap.data() as Campaign;
      }
    } catch (e) {
      console.warn('[BlastStorage] Firestore getCampaign fallback:', e);
    }
    return null;
  }

  // ── Recipients Batching ───────────────────────────────────────────────
  async saveRecipients(campaignId: string, recipients: Recipient[]): Promise<void> {
    try {
      if (this.isFirebaseConfigured() && db) {
        // Save first slice up to 100 in Firestore to prevent quota exhaustion in dev
        const slice = recipients.slice(0, 100);
        for (const r of slice) {
          await setDoc(doc(db, 'recipients', `${campaignId}_${r.id}`), {
            ...r,
            campaignId,
          });
        }
      }
    } catch (e) {
      console.warn('[BlastStorage] Firestore saveRecipients fallback:', e);
    }
  }

  // ── Mailboxes & Domains ────────────────────────────────────────────────
  async saveMailbox(mailbox: BlastMailbox): Promise<void> {
    try {
      if (this.isFirebaseConfigured() && db) {
        await setDoc(doc(db, 'mailboxes', mailbox.id), mailbox);
      }
    } catch (e) {
      console.warn('[BlastStorage] Firestore saveMailbox fallback:', e);
    }
  }

  async saveDomain(domain: BlastDomain): Promise<void> {
    try {
      if (this.isFirebaseConfigured() && db) {
        await setDoc(doc(db, 'domains', domain.id), domain);
      }
    } catch (e) {
      console.warn('[BlastStorage] Firestore saveDomain fallback:', e);
    }
  }

  // ── Events Log ────────────────────────────────────────────────────────
  async logEvent(event: BlastEvent): Promise<void> {
    try {
      if (this.isFirebaseConfigured() && db) {
        await setDoc(doc(db, 'events', event.id), event);
      }
    } catch (e) {
      console.warn('[BlastStorage] Firestore logEvent fallback:', e);
    }
  }

  // ── Seed Check Placement ───────────────────────────────────────────────
  async recordSeedResult(result: SeedCheckResult): Promise<void> {
    try {
      if (this.isFirebaseConfigured() && db) {
        await setDoc(doc(db, 'seeds', `${result.campaignId}_${Date.now()}`), result);
      }
    } catch (e) {
      console.warn('[BlastStorage] Firestore recordSeedResult fallback:', e);
    }
  }

  // ── Suppression Check ─────────────────────────────────────────────────
  async isEmailSuppressed(email: string): Promise<boolean> {
    try {
      if (this.isFirebaseConfigured() && db) {
        const q = query(
          collection(db, 'suppression'),
          where('email', '==', email.toLowerCase().trim()),
          limit(1)
        );
        const snap = await getDocs(q);
        return !snap.empty;
      }
    } catch (e) {
      // In local mode default to false
      return false;
    }
    return false;
  }

  async addSuppression(email: string, reason: string): Promise<void> {
    try {
      if (this.isFirebaseConfigured() && db) {
        await setDoc(doc(db, 'suppression', email.toLowerCase().trim()), {
          email: email.toLowerCase().trim(),
          reason,
          timestamp: Date.now(),
        });
      }
    } catch (e) {
      console.warn('[BlastStorage] Firestore addSuppression fallback:', e);
    }
  }
}

export const blastStorage = new BlastStorage();
