import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

/**
 * Checks if an email is on the global suppression list (unsubscribes + bounces).
 * Always call this before sending any email.
 */
export async function isSuppressed(email: string): Promise<boolean> {
  try {
    const q = query(
      collection(db, 'suppression'),
      where('email', '==', email.toLowerCase().trim())
    );
    const snap = await getDocs(q);
    return !snap.empty;
  } catch {
    // If Firestore is not configured, default to not suppressed
    return false;
  }
}

export async function filterSuppressed(
  emails: string[]
): Promise<{ clean: string[]; suppressed: string[] }> {
  const results = await Promise.all(
    emails.map(async (e) => ({ email: e, suppressed: await isSuppressed(e) }))
  );
  return {
    clean: results.filter((r) => !r.suppressed).map((r) => r.email),
    suppressed: results.filter((r) => r.suppressed).map((r) => r.email),
  };
}
