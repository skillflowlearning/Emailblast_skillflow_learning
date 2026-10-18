'use client';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/client/api';
import { TEST_RULES, parseTestRecipients, personalizeTest, testDate, testFooter, type TestResult, type TestRecipient } from '@/lib/temporary-test/config';

type Phase = 'idle' | 'sending' | 'waiting' | 'paused' | 'stopped' | 'done';
function counterKey(sender: string, dry: boolean) { return `${TEST_RULES.storagePrefix}:${sender}:${dry ? 'dry' : 'live'}:${testDate()}`; }
function readUsed(key: string) { const value = Number(localStorage.getItem(key) || 0); if (!Number.isInteger(value) || value < 0) throw new Error('Invalid saved counter. Check browser storage before sending.'); return Math.min(TEST_RULES.dailyCap, value); }
export default function TemporaryTestPage() {
  const [raw, setRaw] = useState(''); const [subject, setSubject] = useState('Hello {{name}}'); const [body, setBody] = useState('Hi {{name}},\n\nThis is my own-address email test.');
  const [address, setAddress] = useState(''); const [passcode, setPasscode] = useState(''); const [dry, setDry] = useState(true); const [owned, setOwned] = useState(false);
  const [pauseSeconds, setPauseSeconds] = useState<number>(TEST_RULES.defaultPauseSeconds); const [countdown, setCountdown] = useState(0);
  const [results, setResults] = useState<TestResult[]>([]); const [phase, setPhase] = useState<Phase>('idle'); const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<number>(); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const control = useRef({ paused: false, stop: false }); const running = useRef(false); const parsed = useMemo(() => parseTestRecipients(raw), [raw]);
  const totals = { sent: results.filter((r) => r.status === 'sent').length, failed: results.filter((r) => r.status === 'failed').length, notSent: results.filter((r) => r.status === 'not-sent').length };
  const example = parsed.recipients[0] || { email: 'your-address@example.com', name: 'Name' };
  const pendingKey = `${TEST_RULES.storagePrefix}:pending`;
  const savePending = (all: TestResult[]) => localStorage.setItem(pendingKey, JSON.stringify(all.filter((r) => r.status === 'not-sent')));
  const download = () => {
    const pending = results.filter((r) => r.status === 'not-sent');
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = ['email,reason', ...pending.map((r) => `${escape(r.email)},${escape(r.reason)}`)].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `temporary-test-pending-${testDate()}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };
  const restore = () => { try { const saved = JSON.parse(localStorage.getItem(pendingKey) || '[]') as TestResult[]; setRaw(saved.map((r) => r.email).join('\n')); setNotice(`Loaded ${saved.length} pending addresses. Review ownership before starting a new run.`); } catch { setError('Could not read pending browser data.'); } };
  const start = async () => {
    if (running.current) return; setError(''); setNotice('');
    if (!owned || !passcode || !subject.trim() || !body.trim() || !address.trim()) { setError('Confirm address ownership and fill the passcode, subject, message and business address.'); return; }
    if (!parsed.recipients.length || parsed.recipients.length > TEST_RULES.maxRecipients || parsed.invalid.length) { setError('Enter 1–60 valid unique addresses. Correct the invalid entries first.'); return; }
    if (!Number.isInteger(pauseSeconds) || pauseSeconds < 0 || pauseSeconds > TEST_RULES.maxPauseSeconds) { setError('Batch pause must be 0–3600 whole seconds.'); return; }
    running.current = true; setBusy(true); setResults([]); control.current = { paused: false, stop: false };
    let all: TestResult[] = []; let queue: TestRecipient[] = [...parsed.recipients];
    try {
      const { senderKey } = await api<{ senderKey: string }>('/api/temporary-test', { action: 'prepare', passcode });
      const run = async () => {
        const key = () => counterKey(senderKey, dry);
        let available = Math.max(0, TEST_RULES.dailyCap - readUsed(key())); setRemaining(available);
        const overLimit = queue.slice(available); queue = queue.slice(0, available);
        all = overLimit.map((r) => ({ ...r, status: 'not-sent', reason: 'Not sent: daily limit reached, retry tomorrow', attempted: false }));
        savePending(all); setResults([...all]);
        while (queue.length && !control.current.stop) {
          while (control.current.paused && !control.current.stop) { setPhase('paused'); await new Promise((resolve) => setTimeout(resolve, 250)); }
          if (control.current.stop) break;
          const batchKey = key(); available = Math.max(0, TEST_RULES.dailyCap - readUsed(batchKey));
          if (!available) { all.push(...queue.map((r): TestResult => ({ ...r, status: 'not-sent', reason: 'Not sent: daily limit reached, retry tomorrow', attempted: false }))); queue = []; break; }
          const batch = queue.splice(0, Math.min(TEST_RULES.batchSize, available));
          localStorage.setItem(batchKey, String(readUsed(batchKey) + batch.length)); setRemaining(TEST_RULES.dailyCap - readUsed(batchKey));
          setPhase('sending');
          try {
            const response = await api<{ results: TestResult[]; remainingToday: number }>('/api/temporary-test', { passcode, recipients: batch, subject, body, businessAddress: address, dryRun: dry, batchId: crypto.randomUUID() });
            all.push(...response.results);
            const unused = response.results.filter((r) => !r.attempted).length;
            localStorage.setItem(batchKey, String(Math.max(0, readUsed(batchKey) - unused)));
            localStorage.setItem(key(), String(Math.max(readUsed(key()), TEST_RULES.dailyCap - response.remainingToday)));
          } catch (requestError) {
            all.push(...batch.map((r): TestResult => ({ ...r, status: 'failed', reason: `${(requestError as Error).message} Delivery may be uncertain; reserved quota retained.`, attempted: true })));
            control.current.stop = true;
          }
          setResults([...all]); savePending(all); setRemaining(TEST_RULES.dailyCap - readUsed(key()));
          if (queue.length && !control.current.stop) {
            let seconds = pauseSeconds; setCountdown(seconds); setPhase('waiting');
            while (seconds > 0 && !control.current.stop) {
              if (control.current.paused) { setPhase('paused'); await new Promise((resolve) => setTimeout(resolve, 250)); continue; }
              setPhase('waiting'); await new Promise((resolve) => setTimeout(resolve, 1000));
              if (!control.current.paused) { seconds--; setCountdown(seconds); }
            }
          }
        }
        all.push(...queue.map((r): TestResult => ({ ...r, status: 'not-sent', reason: 'Not sent: stopped by user or batch error; no automatic retry', attempted: false })));
        setResults([...all]); savePending(all); setPhase(control.current.stop ? 'stopped' : 'done');
      };
      if (navigator.locks) await navigator.locks.request(`${TEST_RULES.storagePrefix}:${senderKey}:${dry}`, { ifAvailable: true }, async (lock) => { if (!lock) throw new Error('A test run for this sender is open in another tab.'); await run(); });
      else await run();
    } catch (err) { setError((err as Error).message || 'Test run failed.'); setPhase('stopped'); }
    finally { running.current = false; setBusy(false); setCountdown(0); }
  };
  return <div className="temporary-test max-w-4xl mx-auto space-y-5 pb-28">
    <div className="rounded-xl border border-yellow-400 bg-yellow-100 p-4 font-semibold text-yellow-950 dark:bg-yellow-950 dark:text-yellow-100" role="note">TEMPORARY TEST MODE. Send only to addresses you own.</div>
    <h1 className="text-2xl sm:text-3xl font-bold">Temporary SMTP test</h1>
    <p className="text-sm text-gray-600 dark:text-gray-300">Keep this tab open. Up to 60 addresses, 10 per batch, 50 per sender per day ({TEST_RULES.timeZone}). SMTP sender details stay on the server.</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-100">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="grid gap-5 md:grid-cols-2">
      <div className="space-y-4 min-w-0">
        <label className="block">Recipients<textarea aria-label="Test recipients" disabled={busy} className="test-input min-h-36" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Addresses separated by commas, spaces or new lines" /></label>
        <p className="text-sm">{parsed.recipients.length} unique · {parsed.duplicates} duplicates removed · {parsed.invalid.length} invalid. Names use the address prefix.</p>
        {!!parsed.invalid.length && <p className="text-red-600 break-words">Invalid: {parsed.invalid.join(', ')}</p>}
        <Button variant="outline" disabled={busy} onClick={restore}>Load saved pending addresses</Button>
        <label className="block">Subject<Input disabled={busy} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} /></label>
        <label className="block">Plain-text message<textarea aria-label="Test message" disabled={busy} className="test-input min-h-48" value={body} onChange={(e) => setBody(e.target.value)} maxLength={50000} /></label>
        <label className="block">Physical business address<Input disabled={busy} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} /></label>
        <label className="block">Test passcode<Input type="password" autoComplete="off" disabled={busy} value={passcode} onChange={(e) => setPasscode(e.target.value)} /></label>
        <label className="block">Pause between batches (seconds)<Input type="number" min={0} max={3600} disabled={busy} value={pauseSeconds} onChange={(e) => setPauseSeconds(Number(e.target.value))} /></label>
        <label className="flex items-center gap-3 min-h-11"><input type="checkbox" checked={dry} disabled={busy} onChange={(e) => { setDry(e.target.checked); setRemaining(undefined); }} />Dry run — simulate without sending</label>
        <label className="flex items-start gap-3 min-h-11"><input type="checkbox" checked={owned} disabled={busy} onChange={(e) => setOwned(e.target.checked)} /><span>I own every recipient address in this test.</span></label>
      </div>
      <section className="min-w-0 rounded-2xl border p-4 dark:border-gray-700 space-y-3 self-start" aria-label="Live message preview">
        <h2 className="font-semibold">Live preview</h2><p className="text-sm break-words">To: {example.email}</p><strong className="block break-words">{personalizeTest(subject, example)}</strong>
        <pre className="whitespace-pre-wrap break-words font-sans text-sm">{personalizeTest(body, example) + testFooter('[Server-configured sender name]', address || '[Your business address]', '[Signed opt-out link added by server]')}</pre>
        <p className="text-xs text-gray-500">Sender name/address and signed unsubscribe headers are appended on the server. SMTP acceptance does not guarantee inbox placement.</p>
      </section>
    </div>
    <section aria-live="polite" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[['Sent' + (dry ? ' (dry run)' : ''), totals.sent], ['Failed', totals.failed], ['Not sent', totals.notSent], ['Remaining today', remaining ?? 'Check on start']].map(([label, value]) => <div key={label} className="rounded-xl border p-3 dark:border-gray-700"><p className="text-sm">{label}</p><strong className="text-xl">{value}</strong></div>)}
    </section>
    <p role="status">Status: {phase}{phase === 'waiting' || phase === 'paused' ? ` · Next batch in ${countdown}s` : ''}</p>
    <p className="text-sm text-gray-500">Pause/Stop prevents the next batch; the current server batch may finish. Failed or uncertain attempts are never retried automatically and conservatively consume daily quota. Dry-run quota is separate.</p>
    {!!results.length && <section className="space-y-3"><h2 className="font-semibold">Per-recipient results</h2><Button variant="outline" onClick={download}>Download not-sent list</Button>{results.map((result) => <article key={result.email} className="rounded-xl border p-3 dark:border-gray-700 break-words"><strong>{result.email}</strong><p>{result.status === 'sent' && dry ? 'Simulated sent' : result.status} — {result.reason}</p></article>)}</section>}
    <div className="mobile-action-bar flex flex-wrap gap-2 rounded-xl border bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <Button disabled={busy} onClick={start}>{busy ? 'Run in progress' : dry ? 'Start dry run' : 'Send owned-address test'}</Button>
      <Button variant="outline" disabled={!busy} onClick={() => { control.current.paused = !control.current.paused; setPhase(control.current.paused ? 'paused' : 'waiting'); }}>{phase === 'paused' ? 'Resume' : 'Pause'}</Button>
      <Button variant="destructive" disabled={!busy} onClick={() => { control.current.stop = true; control.current.paused = false; setNotice('Stopping after the current server batch.'); }}>Stop</Button>
    </div>
  </div>;
}
