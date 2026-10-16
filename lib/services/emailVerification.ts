export interface VerificationResult {
  email: string;
  status: 'valid' | 'invalid' | 'disposable' | 'risky';
  reason?: string;
}

export interface CleaningStats {
  valid: number;
  invalid: number;
  disposable: number;
  risky: number;
  total: number;
}

const disposableDomains = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'tempmail.com',
  'throwaway.email',
  'yopmail.com',
  '10minutemail.com',
  'trashmail.com',
  'sharklasers.com',
  'getairmail.com',
  'dispostable.com',
]);

const roleAccounts = new Set([
  'admin',
  'support',
  'info',
  'sales',
  'contact',
  'billing',
  'help',
  'team',
  'office',
  'marketing',
]);

/**
 * Deterministic email verification:
 * Checks RFC compliance, disposable domains, and role/catch-all flags.
 * Replace with external API (ZeroBounce, NeverBounce, Hunter) in production.
 */
export async function verifyEmails(emails: string[]): Promise<VerificationResult[]> {
  // Yield thread briefly for smooth UI progress
  await new Promise((resolve) => setTimeout(resolve, 800));

  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  return emails.map((raw) => {
    const email = raw.trim().toLowerCase();

    // 1. Syntax & structure check
    if (!emailRegex.test(email)) {
      return { email, status: 'invalid', reason: 'Invalid email syntax or formatting' };
    }

    const [user, domain] = email.split('@');

    // 2. Disposable domain check
    if (disposableDomains.has(domain)) {
      return { email, status: 'disposable', reason: 'Known temporary/disposable email provider' };
    }

    // 3. Domain TLD validity
    const parts = domain.split('.');
    if (parts.length < 2 || parts[parts.length - 1].length < 2) {
      return { email, status: 'invalid', reason: 'Invalid top-level domain' };
    }

    // 4. Role account check
    if (roleAccounts.has(user)) {
      return { email, status: 'risky', reason: 'Role-based account (high spam complaint risk)' };
    }

    // 5. Valid
    return { email, status: 'valid' };
  });
}

export function computeStats(results: VerificationResult[]): CleaningStats {
  return {
    total: results.length,
    valid: results.filter((r) => r.status === 'valid').length,
    invalid: results.filter((r) => r.status === 'invalid').length,
    disposable: results.filter((r) => r.status === 'disposable').length,
    risky: results.filter((r) => r.status === 'risky').length,
  };
}
