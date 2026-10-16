'use client';
import { useEffect, useState } from 'react';
import { api, getSession } from '@/lib/client/api';
import type { DomainRecord, MailboxRecord } from '@/lib/server/model';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Setup {
  domains: DomainRecord[]; mailboxes: MailboxRecord[];
  connections: { id: string; email: string; role: string; revoked?: boolean }[];
  workerHeartbeat?: number;
  uncertainDeliveries: { id: string; mailboxId: string; startedAt: number }[];
  setup: { storage: string; googleConfigured: boolean; liveEnabled: boolean; queueConfigured: boolean; localWorker: boolean };
}
export default function DomainsPage() {
  const [workspace, setWorkspace] = useState<Setup>(); const [name, setName] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = () => api<Setup>('/api/workspace').then(setWorkspace).catch((error) => setError(error.message));
  useEffect(() => { const query = new URLSearchParams(window.location.search); if (query.has('connectionError')) setError('Google connection was not completed. Check OAuth setup, permissions, and add the sending domain first.'); if (query.has('connected')) setNotice('Google account connected. Run the DNS and seed health checks before activating it.'); load(); const timer = setInterval(load, 5000); return () => clearInterval(timer); }, []);
  const action = async (body: unknown) => { setBusy(true); setError(''); setNotice(''); try { await api('/api/workspace', body); await load(); setNotice('Saved. Health probes wait two minutes for a matching seed result.'); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  const connect = async (role: string) => { await getSession(); window.location.href = `/api/google/connect?role=${role}`; };
  return <div className="max-w-4xl mx-auto space-y-6 pb-12">
    <div><h1 className="text-3xl font-bold">Domains & Google Workspace</h1><p className="text-gray-500 mt-2">Verify your sending domains, connect mailboxes, and check their health before live sending.</p></div>
    {error && <div role="alert" className="p-4 rounded-xl bg-red-50 text-red-700">{error}</div>}
    {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    {!!workspace?.uncertainDeliveries?.length && <div className="p-4 rounded-xl bg-amber-50 space-y-2 text-sm">
      <p>{workspace.uncertainDeliveries.length} delivery result(s) are uncertain after interruption. Sending is held to prevent duplicates.</p>
      <p>Check Gmail Sent for the saved message ID. A missing result stays held and is never automatically retried.</p>
      <Button disabled={busy} variant="outline" onClick={async () => { setBusy(true); setError(''); try { const result = await api<{ confirmed: number; remaining: number }>('/api/workspace', { action: 'review-deliveries' }); setNotice(`${result.confirmed} confirmed sent; ${result.remaining} still held for review.`); await load(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } }}>Check uncertain deliveries</Button>
    </div>}
    {workspace && <div className="p-4 bg-blue-50 border rounded-xl text-sm space-y-1">
      <p>Storage: <strong>{workspace.setup.storage === 'local' ? 'saved locally on this computer' : 'Firestore'}</strong></p>
      <p>Google connection: {workspace.setup.googleConfigured ? 'configured' : 'setup needed'}. Live sending: {workspace.setup.liveEnabled ? 'enabled' : 'disabled'}.</p>
      <p>Worker: {workspace.workerHeartbeat && Date.now() - workspace.workerHeartbeat < 30000 ? 'recently active' : 'start/configure the background worker'}.</p>
      <a href="/setup" className="underline font-medium">Follow the setup steps</a>
    </div>}
    <Card><CardHeader><CardTitle>1. Add sending domains</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-gray-500">Automatic domain failover needs two different registered domains. Adding six mailboxes to one domain does not create a second domain.</p>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); action({ action: 'add-domain', name }); }}>
        <Input aria-label="Sending domain" placeholder="skillflowlearning.org" value={name} onChange={(event) => setName(event.target.value)} />
        <Button disabled={busy || !name.trim()}>Add domain</Button>
      </form>
      {workspace?.domains.map((domain) => <DomainCard key={domain.id} domain={domain} busy={busy} action={action} />)}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>2. Connect Google Workspace mailboxes</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-gray-500">Connect each independent mailbox. Email is sent from your own domain. A separate owned seed inbox receives health probes.</p>
      <div className="flex gap-2 flex-wrap">
        <Button disabled={!workspace?.setup.googleConfigured || busy} onClick={() => connect('sender')}>Connect sending mailbox</Button>
        <Button variant="outline" disabled={!workspace?.setup.googleConfigured || busy} onClick={() => connect('seed')}>Connect owned seed inbox</Button>
      </div>
      {!workspace?.setup.googleConfigured && <p className="text-sm text-amber-700">Complete Google OAuth setup first. Credentials are configured on the server, never pasted here.</p>}
      {workspace?.connections.filter((connection) => !connection.revoked).map((connection) => <div key={connection.id} className="flex items-center justify-between border rounded-xl p-3 text-sm gap-2">
        <span>{connection.email} <Badge variant="outline">{connection.role}</Badge></span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => action({ action: 'disconnect', id: connection.id })}>Disconnect</Button>
      </div>)}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>3. Health checks & spare mailbox</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-gray-500">A health test sends a real message to your connected seed inbox. Activation requires a matching Inbox or Promotions result. Recovery checks must happen after cooldown.</p>
      {!workspace?.mailboxes.length && <p className="text-sm text-gray-400">Connect your sending mailboxes to see their health here.</p>}
      {workspace?.mailboxes.map((mailbox) => <div key={mailbox.id} className="p-4 border rounded-xl space-y-2">
        <div className="flex flex-wrap gap-2 items-center"><strong>{mailbox.email}</strong><Badge variant="outline">{mailbox.status}</Badge><Badge variant={mailbox.health?.status === 'healthy' ? 'success' : 'secondary'}>{mailbox.health?.status || 'unchecked'}</Badge></div>
        <p className="text-sm text-gray-500">{mailbox.health?.detail || 'A health probe is required before activation.'}</p>
        {mailbox.cooldownUntil && mailbox.cooldownUntil > Date.now() && <p className="text-sm text-amber-700">Cooldown until {new Date(mailbox.cooldownUntil).toLocaleString()}</p>}
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" disabled={busy || mailbox.health?.status === 'checking'} onClick={() => action({ action: 'health', id: mailbox.id })}>Send health probe</Button>
          <Button size="sm" disabled={busy || mailbox.health?.status !== 'healthy'} onClick={() => action({ action: 'mailbox-status', id: mailbox.id, status: 'active' })}>Activate</Button>
          <Button size="sm" variant="outline" disabled={busy || mailbox.health?.status !== 'healthy'} onClick={() => action({ action: 'mailbox-status', id: mailbox.id, status: 'spare' })}>Keep as spare</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => action({ action: 'mailbox-status', id: mailbox.id, status: 'paused' })}>Pause</Button>
        </div>
      </div>)}
    </CardContent></Card>
  </div>;
}
function DomainCard({ domain, busy, action }: { domain: DomainRecord; busy: boolean; action: (body: unknown) => Promise<void> }) {
  const [selector, setSelector] = useState(domain.dkimSelector); const [budget, setBudget] = useState(String(domain.dailyBudget));
  return <div className="border rounded-xl p-4 space-y-3">
    <div className="flex items-center gap-2"><strong>{domain.name}</strong><Badge variant={domain.verifiedAt ? 'success' : 'secondary'}>{domain.verifiedAt ? 'DNS verified' : 'setup needed'}</Badge></div>
    <p className="text-sm text-gray-500">Add this TXT record at your domain provider:</p>
    <div className="bg-gray-50 p-3 rounded-lg text-xs break-all font-mono">Name: _mailflow-verify<br />Value: mailflow={domain.verificationToken}</div>
    <p className="text-xs text-gray-500">Also configure Google Workspace MX, SPF, DKIM and DMARC. DNS verification checks records; it is not an inbox-placement guarantee.</p>
    <div className="flex gap-2 flex-wrap items-center text-sm">
      <label>DKIM selector <Input className="w-32 inline-flex ml-2" aria-label={`DKIM selector for ${domain.name}`} value={selector} onChange={(event) => setSelector(event.target.value)} /></label>
      <label>Domain daily budget <Input className="w-24 inline-flex ml-2" type="number" min="1" max="150" aria-label={`Daily budget for ${domain.name}`} value={budget} onChange={(event) => setBudget(event.target.value)} /></label>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => action({ action: 'domain-settings', id: domain.id, dkimSelector: selector, dailyBudget: budget })}>Save limits</Button>
      <Button size="sm" disabled={busy} onClick={() => action({ action: 'verify-domain', id: domain.id })}>Check DNS</Button>
    </div>
    {domain.dns && <div className="text-sm"><p>Ownership {domain.dns.ownership ? '✓' : '✗'} · MX {domain.dns.mx ? '✓' : '✗'} · SPF {domain.dns.spf ? '✓' : '✗'} · DKIM {domain.dns.dkim ? '✓' : '✗'} · DMARC {domain.dns.dmarc ? '✓' : '✗'}</p>{domain.dns.issues.map((issue) => <p key={issue} className="text-amber-700">{issue}</p>)}</div>}
  </div>;
}
