export interface SpamIssue {
  type: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

export interface SpamAnalysisResult {
  score: number; // 1-10, lower is better
  issues: SpamIssue[];
  verdict: 'safe' | 'risky' | 'danger';
}

/**
 * TODO: Replace this stub with a real spam analysis API or custom LLM scoring prompt.
 * Suggested: SpamAssassin rules engine, local heuristic analyzer, or custom LLM deliverability prompt.
 */
export async function analyzeSpamRisk(subject: string, body: string): Promise<SpamAnalysisResult> {
  // STUB: Rule-based analysis for demonstration
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const issues: SpamIssue[] = [];
  let score = 1;

  const spamWords = [
    'free', 'winner', 'prize', 'urgent', 'act now', 'limited time',
    'click here', 'buy now', 'earn money', 'guaranteed', 'no obligation',
    'risk free', 'special promotion', 'this is not spam', 'congratulations',
  ];
  const fullText = `${subject} ${body}`.toLowerCase();

  const foundSpamWords = spamWords.filter((w) => fullText.includes(w));
  if (foundSpamWords.length > 0) {
    score += Math.min(foundSpamWords.length * 1.5, 4);
    issues.push({
      type: 'Spam Trigger Words',
      description: `Found ${foundSpamWords.length} spam trigger word(s): ${foundSpamWords.slice(0, 5).join(', ')}`,
      severity: foundSpamWords.length > 3 ? 'high' : 'medium',
    });
  }

  const urlMatches = body.match(/https?:\/\//g) || [];
  if (urlMatches.length > 3) {
    score += 1.5;
    issues.push({
      type: 'Too Many Links',
      description: `Found ${urlMatches.length} links. Keep it under 3 for better deliverability.`,
      severity: 'medium',
    });
  }

  const capsWords = body.match(/\b[A-Z]{3,}\b/g) || [];
  if (capsWords.length > 3) {
    score += 1;
    issues.push({
      type: 'Excessive CAPS',
      description: `Found ${capsWords.length} all-caps words. This triggers spam filters.`,
      severity: 'medium',
    });
  }

  const hasOptOut = /unsubscribe|opt.?out|remove me/i.test(body);
  if (!hasOptOut) {
    score += 2;
    issues.push({
      type: 'Missing Opt-Out',
      description: 'No unsubscribe/opt-out link found. This is required by CAN-SPAM and GDPR.',
      severity: 'high',
    });
  }

  const hasAddress =
    /\d+.*\w+.*(street|st|avenue|ave|road|rd|blvd|drive|dr|lane|ln)/i.test(body);
  if (!hasAddress) {
    score += 0.5;
    issues.push({
      type: 'Missing Business Address',
      description: 'CAN-SPAM requires a physical postal address in every commercial email.',
      severity: 'low',
    });
  }

  if (subject.length > 60) {
    score += 0.5;
    issues.push({
      type: 'Long Subject Line',
      description: 'Subject lines over 60 characters may be truncated and can reduce open rates.',
      severity: 'low',
    });
  }

  score = Math.min(Math.round(score), 10);
  const verdict = score <= 3 ? 'safe' : score <= 6 ? 'risky' : 'danger';
  return { score, issues, verdict };
}
