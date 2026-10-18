'use client';
import { useState } from 'react';
import { AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import Stepper from '@/components/layout/Stepper';
import { analyzeSpamRisk, type SpamAnalysisResult } from '@/lib/services/spamAnalysis';

const steps = [{ label: 'Input' }, { label: 'Analyze' }, { label: 'Report' }];

export default function SpamCheckPage() {
  const [step, setStep] = useState(0);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SpamAnalysisResult | null>(null);

  const analyze = async () => {
    setStep(1);
    setLoading(true);
    const res = await analyzeSpamRisk(subject, body);
    setLoading(false);
    setResult(res);
    setStep(2);
  };

  const scoreColor = (score: number) =>
    score <= 3 ? 'text-green-600' : score <= 6 ? 'text-yellow-600' : 'text-red-600';

  const severityVariant = (s: string) =>
    s === 'high' ? 'destructive' : s === 'medium' ? 'warning' : 'secondary';

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">Spam Risk Check</h1>
        <p className="text-gray-500 dark:text-gray-400">
          Paste your email subject and body to get a deliverability score.
        </p>
      </div>
      <Stepper steps={steps} currentStep={step} />

      {(step === 0 || step === 1) && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label>Subject Line</Label>
              <Input
                placeholder="e.g. Limited time offer just for you!"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Email Body</Label>
              <Textarea
                placeholder="Paste your full email body here..."
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            <Button
              className="mobile-action-button w-full"
              onClick={analyze}
              disabled={!subject.trim() || !body.trim() || loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...
                </>
              ) : (
                'Check Spam Risk'
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && result && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6 flex items-center gap-6">
              <div className="text-center">
                <p className={`text-6xl font-bold ${scoreColor(result.score)}`}>{result.score}</p>
                <p className="text-xs text-gray-400 mt-1">/ 10 spam score</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-gray-900 dark:text-white capitalize">
                  {result.verdict === 'safe'
                    ? '✅ Looking Good'
                    : result.verdict === 'risky'
                    ? '⚠️ Risky'
                    : '🚨 High Spam Risk'}
                </p>
                <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                  {result.verdict === 'safe'
                    ? 'Your email has a good chance of landing in the inbox.'
                    : result.verdict === 'risky'
                    ? 'Some fixes are recommended before sending.'
                    : 'Fix these issues before sending or expect poor deliverability.'}
                </p>
              </div>
            </CardContent>
          </Card>

          {result.issues.length > 0 && (
            <Card>
              <CardContent className="pt-6 space-y-3">
                <h3 className="font-semibold text-gray-900 dark:text-white">Issues Found</h3>
                {result.issues.map((issue, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800"
                  >
                    <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm text-gray-900 dark:text-white">
                          {issue.type}
                        </span>
                        <Badge variant={severityVariant(issue.severity) as any}>
                          {issue.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {issue.description}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {result.issues.length === 0 && (
            <Card>
              <CardContent className="pt-6 flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <p className="text-gray-600 dark:text-gray-400">
                  No issues found. Your email looks clean!
                </p>
              </CardContent>
            </Card>
          )}

          <Button
            variant="outline"
            className="mobile-action-button w-full"
            onClick={() => {
              setStep(0);
              setResult(null);
              setSubject('');
              setBody('');
            }}
          >
            Check Another Email
          </Button>
        </div>
      )}
    </div>
  );
}
