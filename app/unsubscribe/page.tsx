'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, ShieldCheck, Mail, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || searchParams.get('recipient') || '';
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [unsubscribed, setUnsubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}`).then((response) => response.json()).then((result) => {
        if (result.email) setEmail(result.email); else setError(result.error || 'Invalid unsubscribe link.');
      }).catch(() => setError('Unable to verify this unsubscribe link.'));
    }
  }, [token]);

  const handleUnsubscribe = async () => {
    if (!email || !email.includes('@')) {
      setError('Please provide a valid email address.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        throw new Error('Failed to process unsubscribe request');
      }

      setUnsubscribed(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center p-4">
      <Card className="max-w-md w-full rounded-3xl p-6 sm:p-8 text-center bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800">
        <CardContent className="pt-2 space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-2">
            <Mail className="w-7 h-7" />
          </div>

          {!unsubscribed ? (
            <>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Unsubscribe from Mailing List
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                You will no longer receive marketing and outreach communications from our senders.
              </p>

              {error && (
                <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/30 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-3 pt-2 text-left">
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Recipient Email:
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none"
                />

                <Button
                  onClick={handleUnsubscribe}
                  disabled={loading || !email.trim()}
                  className="w-full rounded-xl mt-2 font-medium"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Unsubscribing...
                    </>
                  ) : (
                    'Confirm One-Click Unsubscribe'
                  )}
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-3 py-4">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Successfully Unsubscribed
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                <span className="font-semibold text-gray-900 dark:text-white">{email}</span> has been permanently added to our global suppression list. You will not receive future outreach emails.
              </p>
            </div>
          )}

          <div className="pt-4 border-t border-gray-200 dark:border-gray-700/60 flex items-center justify-center gap-1.5 text-[11px] text-gray-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>CAN-SPAM &amp; RFC 8058 One-Click Compliant</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white dark:bg-gray-900" />}>
      <UnsubscribeContent />
    </Suspense>
  );
}
