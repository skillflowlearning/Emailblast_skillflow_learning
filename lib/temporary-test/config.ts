// TEMPORARY: delete this folder and its page/API when SMTP testing is finished.
export const TEST_RULES = {
  dailyCap: 50, maxRecipients: 60, batchSize: 10,
  gapMinSeconds: 3, gapMaxSeconds: 8, defaultPauseSeconds: 120,
  maxPauseSeconds: 3600, requestBudgetMs: 90000,
  timeZone: 'Asia/Kolkata', storagePrefix: 'mailflow-temporary-smtp-v1',
} as const;

export type TestRecipient = { email: string; name: string };
export type TestResult = TestRecipient & { status: 'sent' | 'failed' | 'not-sent'; reason: string; attempted: boolean };
export function testDate(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TEST_RULES.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function validTestEmail(value: string) {
  return value.length <= 254 && /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i.test(value) && !value.includes('..');
}
export function parseTestRecipients(input: string) {
  const recipients: TestRecipient[] = []; const invalid: string[] = []; const seen = new Set<string>(); let duplicates = 0;
  for (const token of input.split(/[\s,;]+/).filter(Boolean)) {
    const email = token.trim().toLowerCase();
    if (!validTestEmail(email)) { invalid.push(token); continue; }
    if (seen.has(email)) { duplicates++; continue; } seen.add(email);
    const name = email.split('@')[0].split(/[._+\-]/)[0] || 'there';
    recipients.push({ email, name: name.charAt(0).toUpperCase() + name.slice(1) });
  }
  return { recipients, invalid, duplicates };
}
export function personalizeTest(text: string, recipient: TestRecipient) { return text.replace(/\{\{name\}\}/gi, recipient.name); }
export function testFooter(sender: string, address: string, unsubscribe: string) {
  return `\n\n${sender}\n${address}\nTo unsubscribe, reply STOP or visit: ${unsubscribe}`;
}
