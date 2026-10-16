'use client';
import { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Clock,
  ShieldAlert,
  ShieldCheck,
  Globe,
  Mail,
  Zap,
  Activity,
  ArrowRight,
  Info,
  Bug,
  FastForward,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Campaign,
  Recipient,
  BlastDomain,
  BlastMailbox,
  BlastEvent,
  MailboxStatus,
  DomainStatus,
} from '@/lib/types/blast';
import { BLAST_CONFIG } from '@/lib/config/blastConfig';
import { blastEngine, EngineState, sendingDate } from '@/lib/services/blastEngine';
import { api } from '@/lib/client/api';

interface LiveCampaignViewProps {
  savedCampaignId?: string;
  initialEngineState?: EngineState;
  initialCampaign: Campaign;
  initialRecipients: Recipient[];
  initialDomains: BlastDomain[];
  initialMailboxes: BlastMailbox[];
  onReset: () => void;
}

export default function LiveCampaignView({
  initialCampaign,
  initialRecipients,
  initialDomains,
  initialMailboxes,
  onReset,
  savedCampaignId,
  initialEngineState,
}: LiveCampaignViewProps) {
  // Engine State
  const [engineState, setEngineState] = useState<EngineState>(() => initialEngineState || ({
    campaign: initialCampaign,
    recipients: initialRecipients,
    domains: initialDomains,
    mailboxes: initialMailboxes,
    events: [
      {
        id: `evt-start-${Date.now()}`,
        campaignId: initialCampaign.id,
        timestamp: Date.now(),
        level: 'info',
        title: 'Campaign Initialized',
        description: `Campaign started with ${initialRecipients.length} recipients across ${initialMailboxes.filter((m) => m.status === 'active').length} active mailboxes.`,
      },
    ],
    seedIndex: 0,
    simulationMode: initialCampaign.providerMode !== 'live',
    simulationSpeedMultiplier: 60,
    delayedSignalMailboxes: [],
  }));

  // Auto-Simulation running state
  const [isSimulating, setIsSimulating] = useState(true);
  const [targetInjectMailboxId, setTargetInjectMailboxId] = useState<string>('auto');
  const [eventFilter, setEventFilter] = useState<'all' | 'issues' | 'seeds'>('all');
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const isTickingRef = useRef(false);
  const [isTicking, setIsTicking] = useState(false);
  const [liveSeeds, setLiveSeeds] = useState<string[]>([]);
  const [requestError, setRequestError] = useState('');
  const [workerHeartbeat, setWorkerHeartbeat] = useState<number>();

  const { campaign, recipients, domains, mailboxes, events } = engineState;
  const serverAction = async (action: string, target?: string) => {
    if (!savedCampaignId) return;
    setRequestError('');
    try { const result = await api<{ state: EngineState }>(`/api/campaigns/${savedCampaignId}`, { action, target }); setEngineState(result.state); }
    catch (error) { setRequestError((error as Error).message); }
  };
  useEffect(() => {
    if (!savedCampaignId) return;
    let cancelled = false;
    const refresh = () => api<{ state: EngineState; killSwitch: boolean; workerHeartbeat?: number }>(`/api/campaigns/${savedCampaignId}`)
      .then((result) => { if (!cancelled) { setEngineState(result.state); setKillSwitchActive(result.killSwitch); setWorkerHeartbeat(result.workerHeartbeat); } })
      .catch((error) => { if (!cancelled) setRequestError(error.message); });
    refresh(); const timer = setInterval(refresh, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [savedCampaignId]);

  // Sync initial kill switch status from server
  useEffect(() => {
    api<{ killSwitchActive: boolean; seedEmails: string[] }>('/api/blast/worker', { action: 'status' })
      .then((d) => {
        if (d.killSwitchActive) setKillSwitchActive(true);
        if (Array.isArray(d.seedEmails)) setLiveSeeds(d.seedEmails);
      })
      .catch(() => {});
  }, []);

  // ── Global Emergency Kill Switch Handler ──────────────────────────────────
  const handleToggleKillSwitch = async () => {
    const next = !killSwitchActive;

    try {
      await api('/api/blast/worker', { action: next ? 'kill' : 'unkill' });
      setKillSwitchActive(next); setRequestError('');
    } catch (err) {
      setRequestError((err as Error).message || 'Emergency stop could not be saved.');
      return;
    }

    if (next) {
      setEngineState((prev) => ({
        ...prev,
        campaign: { ...prev.campaign, status: 'paused' },
        events: [
          {
            id: `evt-kill-${Date.now()}`,
            campaignId: prev.campaign.id,
            timestamp: Date.now(),
            level: 'error',
            title: 'EMERGENCY KILL SWITCH ENGAGED',
            description:
              'Global safety kill switch activated. All outbound message dispatching immediately stopped across all mailboxes and server workers.',
          },
          ...prev.events,
        ],
      }));
    } else {
      setEngineState((prev) => ({
        ...prev,
        events: [
          {
            id: `evt-unkill-${Date.now()}`,
            campaignId: prev.campaign.id,
            timestamp: Date.now(),
            level: 'info',
            title: 'Kill Switch Disengaged',
            description:
              'Global kill switch released. Sending safety checks restored; you may resume the campaign.',
          },
          ...prev.events,
        ],
      }));
    }
  };

  // ── Auto-Tick Loop (Simulates parallel batches via server worker) ──────────
  useEffect(() => {
    if (savedCampaignId) return;
    if (!isSimulating || !['running', 'alert_paused'].includes(campaign.status) || killSwitchActive) return;

    const interval = setInterval(async () => {
      if (isTickingRef.current) return;
      isTickingRef.current = true;
      setIsTicking(true);

      try {
        // Pick an active mailbox that still has pending recipients and cap
        const activeMailboxes = engineState.mailboxes.filter(
          (m) =>
            m.status === 'active' &&
            (Boolean(m.signalCheckAt) || (campaign.status === 'running' &&
              ((m.dailyResetDate && m.dailyResetDate !== sendingDate(campaign, Date.now())) ||
              (m.dailyCap - m.sentToday > 0 && engineState.recipients.some((r) => r.mailboxId === m.id && r.status === 'pending')))))
        );

        if (activeMailboxes.length > 0) {
          // Process one active mailbox per tick to simulate realistic parallel staggered batches
          const randomActive = activeMailboxes.sort((a, b) =>
            (a.signalCheckAt || a.nextSendAt || 0) - (b.signalCheckAt || b.nextSendAt || 0))[0];

          let updatedState: EngineState;
          if (engineState.simulationMode) {
            updatedState = (await blastEngine.processMailboxBatch(randomActive.id, engineState)).updatedState;
          } else {
            const workerRes = await fetch('/api/blast/worker', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'tick',
                mailboxId: randomActive.id,
                engineState,
              }),
            });

            if (!workerRes.ok) {
              const errData = await workerRes.json().catch(() => null);
              if (errData?.killed) {
                setKillSwitchActive(true);
              }
              throw new Error(errData?.error || 'Worker request failed. Sending paused.');
            }
            const workerData = await workerRes.json();
            if (!workerData.updatedState) throw new Error('Worker returned no campaign state.');
            updatedState = workerData.updatedState;
          }
          setEngineState((prev) => ({ ...updatedState,
            campaign: prev.campaign.status === 'running' ? updatedState.campaign
              : { ...updatedState.campaign, status: prev.campaign.status },
          }));
        } else {
          // Check if all pending are done
          const pendingRemaining = engineState.recipients.some((r) => r.status === 'pending' || r.status === 'sending');
          if (!pendingRemaining && campaign.status === 'running') {
            setEngineState((prev) => ({
              ...prev,
              campaign: {
                ...prev.campaign,
                status: 'completed',
                completedAt: Date.now(),
              },
              events: [
                {
                  id: `evt-finish-${Date.now()}`,
                  campaignId: prev.campaign.id,
                  timestamp: Date.now(),
                  level: 'success',
                  title: 'Campaign Completed',
                  description: 'All scheduled emails dispatched successfully within daily safety limits.',
                },
                ...prev.events,
              ],
            }));
          }
        }
      } catch (err) {
        console.error('[LiveCampaignView] Tick execution error:', err);
        setEngineState((prev) => ({ ...prev, campaign: { ...prev.campaign, status: 'alert_paused',
          rootCauseHint: err instanceof Error ? err.message : 'Worker unavailable. Sending paused.' } }));
      } finally {
        isTickingRef.current = false;
        setIsTicking(false);
      }
    }, 2000); // 2-second simulation tick interval

    return () => clearInterval(interval);
  }, [isSimulating, campaign.status, killSwitchActive, engineState, savedCampaignId]);

  // ── Manual Step Batch (Run 1 Batch on all active mailboxes) ─────────────
  const handleStepBatch = async () => {
    if (savedCampaignId) return;
    if (!engineState.simulationMode || campaign.status !== 'running' || killSwitchActive || isTickingRef.current) return;
    isTickingRef.current = true;
    setIsTicking(true);
    try {
    let currentState = engineState;

    const activeMailboxes = currentState.mailboxes.filter(
      (m) => m.status === 'active' && m.dailyCap - m.sentToday > 0
    );

    for (const mbx of activeMailboxes) {
      const res = await blastEngine.processMailboxBatch(mbx.id, currentState);
      currentState = res.updatedState;
    }

    setEngineState(currentState);
    } finally { isTickingRef.current = false; setIsTicking(false); }
  };

  // ── Manual Campaign Pause / Resume ───────────────────────────────────────
  const toggleCampaignStatus = () => {
    if (savedCampaignId) { void serverAction(campaign.status === 'running' ? 'pause' : 'resume'); return; }
    setEngineState((prev) => {
      const nextStatus = prev.campaign.status === 'running' ? 'paused' : 'running';
      const event: BlastEvent = {
        id: `evt-manual-${Date.now()}`,
        campaignId: prev.campaign.id,
        timestamp: Date.now(),
        level: 'info',
        title: nextStatus === 'running' ? 'Campaign Resumed' : 'Campaign Paused Manually',
        description: `Campaign state transitioned to ${nextStatus}.`,
      };
      return {
        ...prev,
        campaign: { ...prev.campaign, status: nextStatus },
        events: [event, ...prev.events],
      };
    });
  };

  // ── Manual Mailbox Pause / Resume ────────────────────────────────────────
  const toggleMailboxStatus = (mailboxId: string) => {
    if (savedCampaignId) { void serverAction('mailbox', mailboxId); return; }
    setEngineState((prev) => {
      const target = prev.mailboxes.find((m) => m.id === mailboxId);
      if (!target) return prev;
      if (target.status !== 'active') return blastEngine.resumeMailbox(mailboxId, prev);

      const newStatus: MailboxStatus = target.status === 'active' ? 'paused' : 'active';
      let updatedMailboxes = prev.mailboxes.map((m) =>
        m.id === mailboxId ? { ...m, status: newStatus } : m
      );

      let updatedRecipients = prev.recipients;
      let updatedEvents = [
        {
          id: `evt-mbx-${Date.now()}`,
          campaignId: prev.campaign.id,
          timestamp: Date.now(),
          level: newStatus === 'active' ? ('info' as const) : ('warn' as const),
          title: `Mailbox ${newStatus === 'active' ? 'Resumed' : 'Paused Manually'}`,
          description: `${target.displayName} (${target.email}) set to ${newStatus}.`,
          mailboxId,
          domainId: target.domainId,
        },
        ...prev.events,
      ];

      // If paused, reallocate unsent emails to healthy mailboxes
      if (newStatus === 'paused') {
        const realloc = blastEngine.reallocateUnsentRecipients(
          updatedRecipients,
          updatedMailboxes,
          updatedEvents,
          prev.campaign.id,
          prev.domains,
        );
        updatedRecipients = realloc.updatedRecipients;
        updatedEvents = realloc.updatedEvents;
        updatedMailboxes = realloc.updatedMailboxes;
      }

      return {
        ...prev,
        mailboxes: updatedMailboxes,
        recipients: updatedRecipients,
        events: updatedEvents,
      };
    });
  };

  // ── Manual Domain Pause / Resume ─────────────────────────────────────────
  const toggleDomainStatus = (domainId: string) => {
    if (savedCampaignId) { void serverAction('domain', domainId); return; }
    setEngineState((prev) => {
      const target = prev.domains.find((d) => d.id === domainId);
      if (!target) return prev;

      if (target.status === 'paused' && prev.mailboxes.some((m) => m.domainId === domainId && (m.cooldownUntil || 0) > Date.now())) return prev;
      const newStatus: DomainStatus = target.status === 'paused' ? 'active' : 'paused';
      const updatedDomains = prev.domains.map((d) =>
        d.id === domainId ? { ...d, status: newStatus } : d
      );

      // If domain paused, pause its mailboxes too
      let updatedMailboxes = prev.mailboxes.map((m) => {
        if (m.domainId === domainId && newStatus === 'paused') {
          return { ...m, status: 'paused' as const };
        }
        return m;
      });

      let updatedRecipients = prev.recipients;
      let updatedEvents = [
        {
          id: `evt-dom-${Date.now()}`,
          campaignId: prev.campaign.id,
          timestamp: Date.now(),
          level: newStatus === 'active' ? ('info' as const) : ('warn' as const),
          title: `Domain ${newStatus === 'active' ? 'Resumed' : 'Paused Manually'}`,
          description: `Domain ${target.name} set to ${newStatus}.`,
          domainId,
        },
        ...prev.events,
      ];

      if (newStatus === 'paused') {
        const realloc = blastEngine.reallocateUnsentRecipients(
          updatedRecipients,
          updatedMailboxes,
          updatedEvents,
          prev.campaign.id,
          updatedDomains,
        );
        updatedRecipients = realloc.updatedRecipients;
        updatedEvents = realloc.updatedEvents;
        updatedMailboxes = realloc.updatedMailboxes;
      }

      return {
        ...prev,
        domains: updatedDomains,
        mailboxes: updatedMailboxes,
        recipients: updatedRecipients,
        events: updatedEvents,
      };
    });
  };

  // ── Simulation Injections ────────────────────────────────────────────────
  const getSelectedMailboxId = (): string | null => {
    if (targetInjectMailboxId !== 'auto') return targetInjectMailboxId;
    const active = mailboxes.filter((m) => m.status === 'active');
    return active.length > 0 ? active[0].id : mailboxes[0]?.id || null;
  };

  const handleInjectBounce = () => {
    const id = getSelectedMailboxId();
    if (!id) return;
    if (savedCampaignId) { void serverAction('inject-bounce', id); return; }
    setEngineState((prev) => blastEngine.injectSimulatedBounce(id, prev));
  };

  const handleInjectSpam = () => {
    const id = getSelectedMailboxId();
    if (!id) return;
    if (savedCampaignId) { void serverAction('inject-spam', id); return; }
    setEngineState((prev) => blastEngine.injectSimulatedSpamPlacement(id, prev));
  };

  const handleInjectDelay = () => {
    const id = getSelectedMailboxId();
    if (!id) return;
    if (savedCampaignId) { void serverAction('inject-delay', id); return; }
    setEngineState((prev) => blastEngine.injectDelayedSignalEvent(id, prev));
  };

  // ── Derived Metrics ──────────────────────────────────────────────────────
  const totalRecipients = recipients.length;
  const sentCount = recipients.filter((r) => r.status === 'sent').length;
  const bouncedCount = recipients.filter((r) => r.status === 'bounced').length;
  const pendingCount = recipients.filter((r) => r.status === 'pending' || r.status === 'sending').length;
  const skippedCount = recipients.filter((r) => r.status === 'skipped').length;

  const progressPercent = totalRecipients > 0 ? Math.round((sentCount / totalRecipients) * 100) : 0;

  const activeMailboxes = mailboxes.filter((m) => m.status === 'active');
  const todaySentTotal = activeMailboxes.reduce((s, m) => s + m.sentToday, 0);
  const todayCapacityTotal = activeMailboxes.reduce((s, m) => s + m.dailyCap, 0);
  const remainingTodayCapacity = Math.max(0, todayCapacityTotal - todaySentTotal);

  const { etaDescription } = blastEngine.computeScheduleETA(
    pendingCount,
    mailboxes
  );

  const filteredEvents = events.filter((e) => {
    if (eventFilter === 'issues') return e.level === 'warn' || e.level === 'error';
    if (eventFilter === 'seeds') return e.title.includes('Seed');
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      {requestError && <p role="alert" className="p-4 bg-red-50 text-red-700 rounded-xl">{requestError}</p>}
      {savedCampaignId && <div className="p-4 bg-blue-50 text-blue-900 rounded-xl text-sm">
        <strong>Campaign saved.</strong> You can close this tab and reopen it from Campaigns.
        <p>{workerHeartbeat ? `Last worker activity: ${new Date(workerHeartbeat).toLocaleString()}.` : 'Start/configure the background worker to continue sending. See the setup guide.'}</p>
      </div>}
      {/* ── Top Header & Campaign Status ──────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
              {campaign.name || 'Live Email Blast'}
            </h1>
            <Badge
              variant={
                campaign.status === 'running'
                  ? 'success'
                  : campaign.status === 'completed'
                  ? 'secondary'
                  : 'destructive'
              }
              className="capitalize px-3 py-1 text-xs"
            >
              {campaign.status === 'running' && (
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse mr-1.5 inline-block" />
              )}
              {campaign.status.replace('_', ' ')}
            </Badge>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Subject: <span className="font-medium text-gray-800 dark:text-gray-200">&ldquo;{campaign.subject}&rdquo;</span>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={killSwitchActive ? 'destructive' : 'outline'}
            onClick={handleToggleKillSwitch}
            className={`rounded-xl gap-2 font-medium text-xs sm:text-sm ${
              killSwitchActive
                ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse'
                : 'border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30'
            }`}
          >
            <ShieldAlert className="w-4 h-4 shrink-0" />
            {killSwitchActive ? 'Kill Switch ACTIVE' : 'Kill Switch'}
          </Button>

          <Button
            variant={campaign.status === 'running' ? 'outline' : 'default'}
            onClick={toggleCampaignStatus}
            disabled={killSwitchActive}
            className="rounded-xl gap-2 font-medium"
          >
            {campaign.status === 'running' ? (
              <>
                <Pause className="w-4 h-4 text-amber-500" /> Pause Blast
              </>
            ) : (
              <>
                <Play className="w-4 h-4 text-green-500" /> Resume Blast
              </>
            )}
          </Button>
          <Button variant="ghost" onClick={onReset} className="rounded-xl text-gray-400 hover:text-gray-600">
            <RotateCcw className="w-4 h-4 mr-1.5" /> New Blast
          </Button>
        </div>
      </div>

      {/* ── Global Kill Switch Emergency Banner ────────────────────────────── */}
      {killSwitchActive && (
        <div className="p-5 rounded-3xl bg-red-600 text-white shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-2 border-red-400 animate-pulse">
          <div className="flex items-center gap-3.5">
            <ShieldAlert className="w-8 h-8 shrink-0 text-white" />
            <div className="space-y-0.5">
              <h3 className="font-bold text-base tracking-wide">
                EMERGENCY GLOBAL KILL SWITCH ENGAGED
              </h3>
              <p className="text-xs text-red-100 leading-relaxed">
                Further sending is suspended. A message already handed to the mail provider may still be delivered.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleToggleKillSwitch}
            className="rounded-xl font-bold text-xs shrink-0 bg-white text-red-700 hover:bg-red-50 shadow-sm"
          >
            Disengage Kill Switch
          </Button>
        </div>
      )}

      {/* ── Honest Deliverability UI Note ─────────────────────────────────── */}
      <div className="p-4 rounded-3xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
          <span className="font-semibold">Honest Deliverability Notice:</span> Real recipients&apos; spam folder placements cannot be detected directly by any system. Deliverability health relies continuously on seed inbox probes, bounce events, and engagement signals.
        </div>
      </div>

      {/* ── Dynamic Root-Cause Alert Banner ────────────────────────────────── */}
      {campaign.status === 'alert_paused' && (
        <div className="p-5 rounded-3xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 flex items-start gap-3.5">
          <AlertCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="font-semibold text-sm text-red-900 dark:text-red-200">
              Campaign Auto-Paused (Reputation Protection Active)
            </h3>
            <p className="text-xs text-red-700 dark:text-red-300">
              {campaign.rootCauseHint || 'Safety triggers fired across active mailboxes.'}
            </p>
          </div>
        </div>
      )}

      {/* ── Simulation Control Panel ───────────────────────────────────────── */}
      {engineState.simulationMode && <Card className="rounded-3xl border-dashed border-2 border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/30 dark:bg-indigo-950/10">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-indigo-900 dark:text-indigo-200">
              <Bug className="w-4 h-4 text-indigo-500" />
              Simulation Testing Sandbox
              <Badge variant="outline" className="text-xs text-indigo-600 border-indigo-300">
                No real email • 60× clock
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={isSimulating ? 'outline' : 'secondary'}
                onClick={() => setIsSimulating(!isSimulating)}
                disabled={Boolean(savedCampaignId)}
                className="h-8 text-xs rounded-xl"
              >
                {savedCampaignId ? 'Background worker' : isSimulating ? (
                  <>
                    <Pause className="w-3 h-3 mr-1" /> Pause Auto-Ticker
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3 mr-1" /> Run Auto-Ticker
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleStepBatch}
                disabled={Boolean(savedCampaignId) || isTicking || killSwitchActive || campaign.status !== 'running'}
                className="h-8 text-xs rounded-xl font-medium"
                title="Send one batch tick immediately"
              >
                <FastForward className="w-3 h-3 mr-1 text-indigo-500" /> Step Next Tick
              </Button>
            </div>
          </div>
          <CardDescription className="text-xs text-indigo-700/80 dark:text-indigo-300/70">
            Inject synthetic signals to verify auto-rules (e.g. bounce &gt;3%, seed spam 2-of-3, domain cascade, and delayed-signal backoff).
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-indigo-100 dark:border-indigo-900/30">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300 mr-1">
              Target Mailbox:
            </span>
            <select
              value={targetInjectMailboxId}
              onChange={(e) => setTargetInjectMailboxId(e.target.value)}
              className="text-xs h-8 rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 px-2.5 font-medium text-gray-800 dark:text-gray-200 focus:outline-none"
            >
              <option value="auto">Auto (First Active Mailbox)</option>
              {mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.status})
                </option>
              ))}
            </select>

            <Button
              size="sm"
              variant="outline"
              onClick={handleInjectBounce}
              disabled={isTicking || killSwitchActive}
              className="h-8 text-xs rounded-xl hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
            >
              + Inject Fake Bounce
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleInjectSpam}
              disabled={isTicking || killSwitchActive}
              className="h-8 text-xs rounded-xl hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950/40"
            >
              + Inject Seed Spam
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleInjectDelay}
              disabled={isTicking || killSwitchActive}
              className="h-8 text-xs rounded-xl hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/40"
            >
              + Inject Delayed Signal
            </Button>
          </div>
        </CardContent>
      </Card>}

      {/* ── Key Metrics Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Overall Progress */}
        <Card className="rounded-3xl">
          <CardContent className="pt-6 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Total Progress
            </p>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold text-gray-900 dark:text-white">
                {sentCount}{' '}
                <span className="text-xs text-gray-400 font-normal">/ {totalRecipients}</span>
              </span>
              <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">
                {progressPercent}%
              </span>
            </div>
            <Progress value={progressPercent} className="h-2 rounded-full" />
            <p className="text-xs text-gray-500 pt-1">{pendingCount} pending emails</p>
          </CardContent>
        </Card>

        {/* Schedule & ETA */}
        <Card className="rounded-3xl">
          <CardContent className="pt-6 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Estimated Completion
            </p>
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-gray-500" />
              <span className="text-lg font-semibold text-gray-900 dark:text-white">
                {pendingCount === 0 ? 'Complete' : 'Safe Pacing'}
              </span>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 leading-relaxed">
              {pendingCount === 0 ? 'All recipients processed.' : etaDescription}
            </p>
          </CardContent>
        </Card>

        {/* Daily Capacity */}
        <Card className="rounded-3xl">
          <CardContent className="pt-6 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Today&apos;s Fleet Capacity
            </p>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold text-gray-900 dark:text-white">
                {todaySentTotal}{' '}
                <span className="text-xs text-gray-400 font-normal">/ {todayCapacityTotal}</span>
              </span>
              <Badge variant="outline" className="text-xs">
                {remainingTodayCapacity} left today
              </Badge>
            </div>
            <p className="text-xs text-gray-500">
              Hard max 50/mailbox/day &bull; Never bursts
            </p>
          </CardContent>
        </Card>

        {/* Health Signals */}
        <Card className="rounded-3xl">
          <CardContent className="pt-6 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Signals &amp; Suppression
            </p>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Bounces detected:</span>
              <span className={`font-semibold ${bouncedCount > 0 ? 'text-red-500' : 'text-gray-800 dark:text-gray-200'}`}>
                {bouncedCount}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Suppressed / Skipped:</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">{skippedCount}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Active mailboxes:</span>
              <span className="font-semibold text-green-600 dark:text-green-400">
                {activeMailboxes.length} / {mailboxes.length}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Domains & Mailboxes Fleet Overview ─────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Sending Domains &amp; Mailboxes
          </h2>
          <span className="text-xs text-gray-500">
            Cooldown: mailbox 48h · domain 72h &bull; Transfers unsent recipients
          </span>
        </div>

        <div className="space-y-4">
          {domains.map((domain) => {
            const domainMailboxes = mailboxes.filter((m) => m.domainId === domain.id);
            const isDomainPaused = domain.status === 'paused';
            const isDomainWatch = domain.status === 'watch';

            return (
              <Card
                key={domain.id}
                className={`rounded-3xl overflow-hidden transition-all border ${
                  isDomainPaused
                    ? 'border-red-200 dark:border-red-950 bg-red-50/20 dark:bg-red-950/10'
                    : isDomainWatch
                    ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/20 dark:bg-amber-950/10'
                    : 'border-gray-200 dark:border-gray-800'
                }`}
              >
                {/* Domain Header */}
                <div className="p-4 sm:p-5 bg-gray-50/70 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-2xl bg-white dark:bg-gray-800 shadow-sm flex items-center justify-center border border-gray-100 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                      <Globe className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-gray-900 dark:text-white">
                          {domain.name}
                        </span>
                        <Badge
                          variant={
                            domain.status === 'active'
                              ? 'success'
                              : domain.status === 'watch'
                              ? 'warning'
                              : 'destructive'
                          }
                          className="capitalize text-xs font-medium"
                        >
                          {domain.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {domainMailboxes.length} Mailboxes &bull;{' '}
                        {domainMailboxes.reduce((s, m) => s + m.sentToday, 0)} sent today
                      </p>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleDomainStatus(domain.id)}
                    disabled={isTicking || (isDomainPaused && domainMailboxes.some((m) => (m.cooldownUntil || 0) > Date.now()))}
                    className="text-xs h-8 rounded-xl self-start sm:self-auto"
                  >
                    {isDomainPaused ? (
                      <>
                        <Play className="w-3.5 h-3.5 mr-1 text-green-500" /> Resume Domain
                      </>
                    ) : (
                      <>
                        <Pause className="w-3.5 h-3.5 mr-1 text-amber-500" /> Pause Domain
                      </>
                    )}
                  </Button>
                </div>

                {/* Mailboxes Grid */}
                <div className="p-4 sm:p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {domainMailboxes.map((mbx) => {
                    const isMbxActive = mbx.status === 'active';
                    const isMbxCooldown = mbx.status === 'cooldown' || mbx.status === 'paused';
                    const hasHighBounce =
                      mbx.totalSent >= BLAST_CONFIG.BOUNCE_RATE_MIN_SENT_EMAILS &&
                      mbx.bounceRate > BLAST_CONFIG.BOUNCE_RATE_THRESHOLD_PERCENT;

                    return (
                      <div
                        key={mbx.id}
                        className={`p-3.5 rounded-2xl border transition-all space-y-2.5 ${
                          isMbxCooldown
                            ? 'bg-red-50/30 dark:bg-red-950/20 border-red-200 dark:border-red-900/40'
                            : 'bg-white dark:bg-gray-800/60 border-gray-100 dark:border-gray-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                              {mbx.displayName}
                            </p>
                            <p className="text-[11px] text-gray-400 truncate">{mbx.email}</p>
                          </div>
                          <Badge
                            variant={
                              mbx.status === 'active'
                                ? 'success'
                                : mbx.status === 'spare'
                                ? 'secondary'
                                : 'destructive'
                            }
                            className="capitalize text-[10px] shrink-0"
                          >
                            {mbx.status}
                          </Badge>
                        </div>

                        {/* Capacity Progress */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-gray-500">
                            <span>Sent today:</span>
                            <span className="font-medium text-gray-700 dark:text-gray-300">
                              {mbx.sentToday} / {mbx.dailyCap} cap
                            </span>
                          </div>
                          <div className="w-full bg-gray-100 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="bg-gray-900 dark:bg-white h-full transition-all"
                              style={{
                                width: `${Math.min(100, (mbx.sentToday / mbx.dailyCap) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>

                        {/* Health & Seed Placements */}
                        <p className="text-[11px] text-gray-500">{mbx.assignedRecipientCount} recipients pending</p>
                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-gray-100 dark:border-gray-700/50">
                          <span
                            className={hasHighBounce ? 'text-red-500 font-bold' : 'text-gray-500'}
                          >
                            Bounce: {mbx.bounceRate}%
                          </span>

                          {/* Seed Dots */}
                          <div className="flex items-center gap-1" title="Recent Seed Checks">
                            {mbx.recentSeedPlacements.slice(-3).map((placement, i) => (
                              <span
                                key={i}
                                className={`w-2 h-2 rounded-full inline-block ${
                                  placement === 'inbox'
                                    ? 'bg-green-500'
                                    : placement === 'promotions'
                                    ? 'bg-blue-400'
                                    : 'bg-red-500'
                                }`}
                                title={`Seed placement: ${placement}`}
                              />
                            ))}
                            {mbx.recentSeedPlacements.length === 0 && (
                              <span className="text-[10px] text-gray-400">No seeds yet</span>
                            )}
                          </div>
                        </div>

                        {/* Cooldown or Backoff Notice */}
                        {isMbxCooldown && (
                          <div className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1 font-medium">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            {mbx.cooldownUntil ? `Cooldown until ${new Date(mbx.cooldownUntil).toLocaleString()}` : 'Mailbox paused'}
                          </div>
                        )}

                        {mbx.backoffActive && isMbxActive && (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 font-medium">
                            <Clock className="w-3 h-3 shrink-0" />
                            Backoff active: 5/batch (2x gap)
                          </div>
                        )}

                        {/* Mailbox Control Button */}
                        <div className="pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleMailboxStatus(mbx.id)}
                            disabled={isTicking || (!isMbxActive && (isDomainPaused || (mbx.cooldownUntil || 0) > Date.now()))}
                            className="w-full h-6 text-[10px] rounded-lg"
                          >
                            {isMbxActive ? 'Pause Mailbox' : mbx.status === 'spare' ? 'Activate Spare' : 'Resume Mailbox'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ── Seed Inboxes & Deliverability Audit ─────────────────────────────── */}
      <Card className="rounded-3xl border border-gray-200 dark:border-gray-800">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2 text-gray-900 dark:text-white">
                <ShieldCheck className="w-4 h-4 text-green-500" />
                Seed Inboxes &amp; Placement Probing
              </CardTitle>
              <CardDescription className="text-xs">
                {engineState.simulationMode ? 'Demo seed inboxes for simulation. No real email is sent.' : 'Configured seed inboxes checked via Gmail API. Every 11th outgoing message is a seed probe.'}
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 self-start sm:self-auto">
              Promotions is NOT spam
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {(engineState.simulationMode ? BLAST_CONFIG.DEFAULT_SEEDS : liveSeeds).map((seedEmail, idx) => {
              // Find latest placement event for this seed if any
              const seedEvt = events.find((e) => e.title.includes('Seed') && e.description.includes(seedEmail));
              const isSpam = seedEvt?.description.toLowerCase().includes('spam');
              const isPromo = seedEvt?.description.toLowerCase().includes('promotions');
              const isInbox = seedEvt?.description.toLowerCase().includes('inbox') || (!isSpam && !isPromo);

              return (
                <div
                  key={seedEmail}
                  className="p-3.5 rounded-2xl bg-gray-50/70 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 space-y-2"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-mono font-medium text-gray-900 dark:text-gray-100 truncate">
                      {seedEmail}
                    </span>
                    <span className="w-2 h-2 rounded-full bg-gray-400 shrink-0" title={engineState.simulationMode ? 'Simulated inbox' : 'Configured inbox; connection checked on probe'} />
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-gray-400">Platform:</span>
                    <span className="text-gray-600 dark:text-gray-300 font-medium">{engineState.simulationMode ? 'Simulation' : 'Google Workspace'}</span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-gray-200/50 dark:border-gray-700/50">
                    <span className="text-gray-400">Placement:</span>
                    {seedEvt ? (
                      <Badge
                        variant={isSpam ? 'destructive' : isPromo ? 'outline' : 'success'}
                        className="text-[10px] px-1.5 py-0 capitalize"
                      >
                        {isSpam ? 'SPAM (Flagged)' : isPromo ? 'Promotions (Safe)' : 'INBOX (Prime)'}
                      </Badge>
                    ) : (
                      <span className="text-gray-400 italic text-[10px]">Awaiting probe #{idx + 1}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3.5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
            <Info className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="space-y-0.5 leading-relaxed text-[11px]">
              <span className="font-semibold">Honest ESP Placement Classification:</span> Cold B2B outreach landing in Google Workspace <em>Promotions</em> tab is normal commercial deliverability and is <strong>NOT</strong> treated as spam. Auto-pause triggers ONLY when messages land in the actual <strong>SPAM</strong> folder 2 out of 3 consecutive seed checks.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Real-time Safety Event Stream ──────────────────────────────────── */}
      <Card className="rounded-3xl">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Activity className="w-4 h-4 text-gray-400" /> Real-Time Signal &amp; Rule Audit
              </CardTitle>
              <CardDescription className="text-xs">
                Audit feed of automated batch results, seed checks, bounce events, and failovers.
              </CardDescription>
            </div>

            <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => setEventFilter('all')}
                className={`px-3 py-1 rounded-lg font-medium transition-all ${
                  eventFilter === 'all'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
                    : 'text-gray-500'
                }`}
              >
                All Events ({events.length})
              </button>
              <button
                type="button"
                onClick={() => setEventFilter('issues')}
                className={`px-3 py-1 rounded-lg font-medium transition-all ${
                  eventFilter === 'issues'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
                    : 'text-gray-500'
                }`}
              >
                Issues ({events.filter((e) => e.level === 'warn' || e.level === 'error').length})
              </button>
              <button
                type="button"
                onClick={() => setEventFilter('seeds')}
                className={`px-3 py-1 rounded-lg font-medium transition-all ${
                  eventFilter === 'seeds'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
                    : 'text-gray-500'
                }`}
              >
                Seeds ({events.filter((e) => e.title.includes('Seed')).length})
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-2">
            {filteredEvents.map((evt) => {
              const isError = evt.level === 'error';
              const isWarn = evt.level === 'warn';
              const isSuccess = evt.level === 'success';

              return (
                <div
                  key={evt.id}
                  className={`p-3.5 rounded-2xl border text-xs space-y-1.5 transition-all ${
                    isError
                      ? 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-900/40'
                      : isWarn
                      ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40'
                      : isSuccess
                      ? 'bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900/40'
                      : 'bg-gray-50/60 dark:bg-gray-800/40 border-gray-100 dark:border-gray-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isError
                            ? 'bg-red-500'
                            : isWarn
                            ? 'bg-amber-500'
                            : isSuccess
                            ? 'bg-green-500'
                            : 'bg-blue-400'
                        }`}
                      />
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {evt.title}
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-400 shrink-0">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  <p className="text-gray-600 dark:text-gray-300 pl-4">{evt.description}</p>

                  {/* Root Cause Hint Tag */}
                  {evt.rootCauseHint && (
                    <div className="ml-4 pt-1 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                      <span>Root cause diagnosis: {evt.rootCauseHint}</span>
                    </div>
                  )}
                </div>
              );
            })}

            {filteredEvents.length === 0 && (
              <div className="py-8 text-center text-xs text-gray-400">
                No events matching this filter.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
