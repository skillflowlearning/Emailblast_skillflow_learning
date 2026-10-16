'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
export default function SettingsPage() {
  const [killed, setKilled] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ killSwitchActive: boolean }>('/api/blast/worker').then((result) => setKilled(result.killSwitchActive)).catch((error) => setError(error.message)); }, []);
  const toggle = async () => { setBusy(true); try { await api('/api/blast/worker', { action: killed ? 'unkill' : 'kill' }); setKilled(!killed); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  return <div className="max-w-3xl mx-auto space-y-6"><h1 className="text-3xl font-bold">Workspace settings</h1>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <Card><CardHeader><CardTitle>Emergency sending stop</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-gray-500">This stop is saved for your workspace and applies to background sending and health probes. A message already handed to Google may still be delivered.</p><Button disabled={busy} variant={killed ? 'destructive' : 'outline'} onClick={toggle}>{killed ? 'Release emergency stop' : 'Stop all sending'}</Button><p className="text-sm">Current state: {killed ? 'sending stopped' : 'normal safety checks active'}</p></CardContent></Card>
    <Card><CardHeader><CardTitle>Connections & limits</CardTitle></CardHeader><CardContent className="space-y-3"><p>Manage verified domains, Google Workspace connections, shared domain budgets, seed checks and the spare mailbox on the Domains page.</p><Button asChild variant="outline"><a href="/domains">Open domains & health checks</a></Button><a className="block underline text-sm" href="/setup">Read setup guide</a></CardContent></Card>
  </div>;
}
