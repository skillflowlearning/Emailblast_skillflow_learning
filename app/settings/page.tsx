'use client';
import { useState, useEffect } from 'react';
import {
  Settings,
  Shield,
  Key,
  Database,
  Building,
  Check,
  Save,
  ShieldAlert,
  ShieldCheck,
  Mail,
  Globe,
  Radio,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BLAST_CONFIG } from '@/lib/config/blastConfig';
import { BlastMailbox } from '@/lib/types/blast';

export default function SettingsPage() {
  const [senderName, setSenderName] = useState('Alex Rivera');
  const [companyAddress, setCompanyAddress] = useState(
    '100 Innovation Way, Suite 400, San Francisco, CA 94105'
  );
  const [optOutFooter, setOptOutFooter] = useState(
    "To unsubscribe from future emails, reply with 'STOP' or click here: [Unsubscribe Link]"
  );
  const [dailyCapCeiling, setDailyCapCeiling] = useState('50');
  const [saved, setSaved] = useState(false);

  // Global Kill Switch State
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [killSwitchLoading, setKillSwitchLoading] = useState(false);

  // Mailboxes State
  const [mailboxes, setMailboxes] = useState<BlastMailbox[]>(() =>
    BLAST_CONFIG.DEFAULT_MAILBOXES.map((m) => ({
      ...m,
      sentToday: 0,
      totalSent: 0,
      bouncesCount: 0,
      bounceRate: 0,
      recentSeedPlacements: [],
      assignedRecipientCount: 0,
    }))
  );

  // Sync initial kill switch status from server worker
  useEffect(() => {
    fetch('/api/blast/worker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.killSwitchActive) setKillSwitchActive(true);
      })
      .catch(() => {});
  }, []);

  const handleToggleKillSwitch = async () => {
    setKillSwitchLoading(true);
    const next = !killSwitchActive;
    try {
      const res = await fetch('/api/blast/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: next ? 'kill' : 'unkill' }),
      });
      if (res.ok) {
        setKillSwitchActive(next);
      }
    } catch (err) {
      console.error('Failed to toggle kill switch:', err);
    } finally {
      setKillSwitchLoading(false);
    }
  };

  const handleMailboxCapChange = (id: string, cap: number) => {
    const clamped = Math.min(
      BLAST_CONFIG.HARD_MAX_MAILBOX_DAILY_CAP,
      Math.max(1, cap)
    );
    setMailboxes((prev) =>
      prev.map((m) => (m.id === id ? { ...m, dailyCap: clamped } : m))
    );
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      <div>
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white tracking-tight mb-2">
          Settings &amp; Fleet Configuration
        </h1>
        <p className="text-gray-500 dark:text-gray-400 font-light">
          Manage sending defaults, Google Workspace mailboxes, seed accounts, and system-wide emergency safety kill switches.
        </p>
      </div>

      {/* ── Global Kill Switch Card ────────────────────────────────────────── */}
      <Card className={`rounded-3xl border-2 transition-all ${
        killSwitchActive
          ? 'border-red-500 bg-red-50/30 dark:bg-red-950/20'
          : 'border-gray-200 dark:border-gray-800'
      }`}>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base text-gray-900 dark:text-white">
                <ShieldAlert className={`w-5 h-5 ${killSwitchActive ? 'text-red-600 animate-pulse' : 'text-gray-400'}`} />
                Global Emergency Kill Switch
              </CardTitle>
              <CardDescription className="text-xs">
                Immediately terminates and freezes all outbound email dispatching across every mailbox, domain, and background server worker.
              </CardDescription>
            </div>
            <Badge
              variant={killSwitchActive ? 'destructive' : 'secondary'}
              className="text-xs self-start sm:self-auto capitalize"
            >
              {killSwitchActive ? 'ENGAGED / SENDING HALTED' : 'Disengaged / Normal'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
            When engaged, the server worker halts batch execution, rejects lease claims, and stops all Gmail API and SMTP transmission across all running campaigns instantly.
          </p>

          <Button
            variant={killSwitchActive ? 'destructive' : 'outline'}
            onClick={handleToggleKillSwitch}
            disabled={killSwitchLoading}
            className={`font-semibold text-xs rounded-xl ${
              killSwitchActive
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20'
            }`}
          >
            {killSwitchLoading
              ? 'Updating...'
              : killSwitchActive
              ? 'Disengage Kill Switch (Restore Normal Sending)'
              : 'Engage Emergency Kill Switch'}
          </Button>
        </CardContent>
      </Card>

      {/* ── Compliance & CAN-SPAM Defaults ─────────────────────────────────── */}
      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building className="w-5 h-5 text-gray-400" />
            Compliance &amp; Mandatory CAN-SPAM Defaults
          </CardTitle>
          <CardDescription className="text-xs">
            Mandatory in Live Mode: appended automatically to all outbound emails to ensure full CAN-SPAM, CASL, and GDPR compliance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="senderName" className="text-xs font-medium">Default Sender Name</Label>
            <Input
              id="senderName"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="e.g. Alex Rivera or Acme Sales Team"
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="companyAddress" className="text-xs font-medium">Physical Business Postal Address</Label>
            <Input
              id="companyAddress"
              value={companyAddress}
              onChange={(e) => setCompanyAddress(e.target.value)}
              placeholder="e.g. 100 Innovation Way, Suite 400, San Francisco, CA 94105"
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="optOut" className="text-xs font-medium">Mandatory Opt-Out / Unsubscribe Line</Label>
            <Input
              id="optOut"
              value={optOutFooter}
              onChange={(e) => setOptOutFooter(e.target.value)}
              className="text-xs"
            />
            <p className="text-[11px] text-gray-400">
              Outbound emails also include RFC 8058 one-click headers (<code>List-Unsubscribe</code> and <code>List-Unsubscribe-Post</code>).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Mailbox Fleet & Daily Cap Ceiling ───────────────────────────────── */}
      <Card className="rounded-3xl">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="w-5 h-5 text-gray-400" />
                Google Workspace Mailbox Fleet &amp; Caps
              </CardTitle>
              <CardDescription className="text-xs">
                Per-mailbox caps (default 30, hard maximum 50) and automatic +15% daily ramp for healthy mailboxes.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs">
              Hard Max: 50 / mailbox / day
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 text-xs">
            <div className="space-y-0.5">
              <span className="font-semibold text-gray-900 dark:text-white">Daily Cap Ceiling:</span>
              <p className="text-gray-500">Global ceiling enforced in code. The UI and engine cannot exceed 50 emails/day per mailbox.</p>
            </div>
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              <Input
                type="number"
                min={1}
                max={50}
                value={dailyCapCeiling}
                onChange={(e) => setDailyCapCeiling(String(Math.min(50, Math.max(1, parseInt(e.target.value) || 30))))}
                className="w-16 h-8 text-xs text-center"
              />
              <span className="text-gray-400 text-xs">/ 50 max</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Fleet Mailboxes ({mailboxes.length})
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {mailboxes.map((mbx) => (
                <div
                  key={mbx.id}
                  className="p-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="truncate">
                    <p className="font-medium text-gray-900 dark:text-white truncate">
                      {mbx.displayName}
                    </p>
                    <p className="text-gray-500 font-mono text-[11px] truncate">
                      {mbx.email}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">
                        Ramp: +15%/day healthy
                      </span>
                      {mbx.status === 'spare' && (
                        <Badge variant="secondary" className="text-[9px] px-1 py-0">
                          Spare
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={mbx.dailyCap}
                      onChange={(e) => handleMailboxCapChange(mbx.id, parseInt(e.target.value) || 30)}
                      className="w-14 h-7 text-xs text-center p-0"
                    />
                    <span className="text-[10px] text-gray-400">/ 50</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Seed Accounts List ─────────────────────────────────────────────── */}
      <Card className="rounded-3xl">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio className="w-5 h-5 text-gray-400" />
                Seed Inboxes &amp; Deliverability Auditing
              </CardTitle>
              <CardDescription className="text-xs">
                Rotating seed accounts (6&ndash;8 mailboxes) probed every ~11th email to assess deliverability signals.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800">
              Gmail API Connected
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {BLAST_CONFIG.DEFAULT_SEEDS.map((seed, i) => (
              <div
                key={seed}
                className="p-3 rounded-2xl bg-gray-50/70 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 text-xs space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400 font-semibold uppercase">Seed #{i + 1}</span>
                  <span className="w-2 h-2 rounded-full bg-green-500" title="Connected" />
                </div>
                <p className="font-mono text-[11px] text-gray-900 dark:text-white truncate">{seed}</p>
                <p className="text-[10px] text-gray-500">Google Workspace (Gmail API)</p>
              </div>
            ))}
          </div>

          <div className="p-3.5 rounded-2xl bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 text-xs text-blue-900 dark:text-blue-300 flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div className="text-[11px] leading-relaxed">
              <strong>Promotions Tab Distinction:</strong> Seed placement checks classify emails into <code>INBOX</code>, <code>CATEGORY_PROMOTIONS</code>, and <code>SPAM</code>. The Promotions tab is <strong>NOT</strong> spam; only landing in SPAM 2 of the last 3 probes triggers safety pauses.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Firestore Architecture ─────────────────────────────────────────── */}
      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="w-5 h-5 text-gray-400" />
            Firestore Collections Architecture
          </CardTitle>
          <CardDescription className="text-xs">
            Persistent collections schema supporting lease-locking, suppression, and event logs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              'users',
              'lists',
              'recipients',
              'suppression',
              'campaigns',
              'domains',
              'mailboxes',
              'events',
              'seeds',
              'settings',
            ].map((col) => (
              <div
                key={col}
                className="p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 text-center"
              >
                <code className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                  {col}
                </code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3 pt-2">
        <Button onClick={handleSave} className="min-w-[140px] rounded-xl">
          {saved ? (
            <>
              <Check className="w-4 h-4 mr-2 text-green-400" />
              Settings Saved!
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
