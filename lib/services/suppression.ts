import { blastStorage } from './blastStorage';

export async function isSuppressed(email: string): Promise<boolean> {
  return blastStorage.isEmailSuppressed(email);
}

export async function filterSuppressed(emails: string[]): Promise<{ clean: string[]; suppressed: string[] }> {
  const results = await Promise.all(emails.map(async (email) => ({ email, suppressed: await isSuppressed(email) })));
  return {
    clean: results.filter((r) => !r.suppressed).map((r) => r.email),
    suppressed: results.filter((r) => r.suppressed).map((r) => r.email),
  };
}
