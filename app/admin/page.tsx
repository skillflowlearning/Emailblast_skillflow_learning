'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Pause,
  Play,
  TrendingUp,
  Globe,
  Mail,
  AlertCircle,
  Plus,
  Send,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type CampaignStatus = 'active' | 'paused' | 'completed';
type DomainHealth = 'green' | 'yellow' | 'red';

interface Campaign {
  id: string;
  name: string;
  sent: number;
  delivered: number;
  bounced: number;
  replied: number;
  unsubscribed: number;
  complaints: number;
  status: CampaignStatus;
}

interface Domain {
  id: string;
  name: string;
  sent: number;
  delivered: number;
  bounced: number;
  replied: number;
  unsubscribed: number;
  complaints: number;
  status: 'active' | 'paused';
  health: DomainHealth;
}

// Clean state: 0 fake records
const initialCampaigns: Campaign[] = [];
const initialDomains: Domain[] = [];

function calculateBounceRate(bounced: number, sent: number): number {
  if (sent === 0) return 0;
  return Number(((bounced / sent) * 100).toFixed(1));
}

function calculateComplaintRate(complaints: number, sent: number): string {
  if (sent === 0) return '0.00%';
  return `${((complaints / sent) * 100).toFixed(2)}%`;
}

function HealthBadge({ health }: { health: DomainHealth }) {
  if (health === 'green') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-600 dark:bg-green-400 animate-pulse" />
        Healthy
      </span>
    );
  }
  if (health === 'yellow') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-600 dark:bg-yellow-400" />
        Degraded
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
      <span className="w-1.5 h-1.5 rounded-full bg-red-600 dark:bg-red-400" />
      Critical
    </span>
  );
}

export default function AdminPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [domains, setDomains] = useState<Domain[]>(initialDomains);

  // Auto-pause rule: if bounce % > 3 on a domain, identify it for warning banner
  const highBounceDomains = domains.filter((d) => calculateBounceRate(d.bounced, d.sent) > 3);

  const toggleCampaignStatus = (id: string) => {
    setCampaigns((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (c.status === 'completed') return c;
        const newStatus: CampaignStatus = c.status === 'active' ? 'paused' : 'active';
        return { ...c, status: newStatus };
      })
    );
  };

  const toggleDomainStatus = (id: string) => {
    setDomains((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d;
        const newStatus = d.status === 'active' ? 'paused' : 'active';
        return { ...d, status: newStatus };
      })
    );
  };

  const totalSent = campaigns.reduce((acc, c) => acc + c.sent, 0);
  const totalDelivered = campaigns.reduce((acc, c) => acc + c.delivered, 0);
  const totalBounced = campaigns.reduce((acc, c) => acc + c.bounced, 0);
  const overallBounceRate = calculateBounceRate(totalBounced, totalSent);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white tracking-tight mb-2">
            Admin Dashboard
          </h1>
          <p className="text-gray-500 dark:text-gray-400 font-light">
            Real-time deliverability overview, domain reputation health, and campaign controls.
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild variant="outline">
            <Link href="/domains">
              <Plus className="w-4 h-4 mr-1.5" />
              Configure Domain
            </Link>
          </Button>
          <Button asChild>
            <Link href="/app/blast">
              <Send className="w-4 h-4 mr-1.5" />
              New Blast
            </Link>
          </Button>
        </div>
      </div>

      {/* Auto-pause alert banner */}
      {highBounceDomains.length > 0 && (
        <div className="p-4 sm:p-5 rounded-3xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-900 dark:text-red-200">
                Auto-Pause Protection Triggered (Bounce Rate &gt; 3%)
              </p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-0.5">
                Sending has been automatically halted on{' '}
                <span className="font-semibold">
                  {highBounceDomains.map((d) => d.name).join(', ')}
                </span>{' '}
                to protect your IP and domain sender reputation.
              </p>
            </div>
          </div>
          <Badge variant="destructive" className="shrink-0 self-start sm:self-center">
            {highBounceDomains.length} Affected Domain{highBounceDomains.length > 1 ? 's' : ''}
          </Badge>
        </div>
      )}

      {/* High-level metrics (starts at 0) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Total Sent
              </span>
              <Mail className="w-4 h-4 text-gray-400" />
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-white">
              {totalSent.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500 mt-1">Across all campaigns</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Delivered
              </span>
              <TrendingUp className="w-4 h-4 text-gray-400" />
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-white">
              {totalDelivered.toLocaleString()}
            </p>
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
              {totalSent > 0 ? `${((totalDelivered / totalSent) * 100).toFixed(1)}% delivery rate` : '0.0% delivery rate'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Global Bounce %
              </span>
              <AlertCircle className="w-4 h-4 text-gray-400" />
            </div>
            <p
              className={`text-3xl font-bold ${
                overallBounceRate > 3
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-900 dark:text-white'
              }`}
            >
              {overallBounceRate}%
            </p>
            <p className="text-xs text-gray-500 mt-1">Threshold limit: &lt; 3.0%</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Active Domains
              </span>
              <Globe className="w-4 h-4 text-gray-400" />
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-white">
              {domains.filter((d) => d.status === 'active').length} / {domains.length}
            </p>
            <p className="text-xs text-gray-500 mt-1">Operational infrastructure</p>
          </CardContent>
        </Card>
      </div>

      {/* Campaigns Table */}
      <Card>
        <CardHeader>
          <CardTitle>Campaigns Overview</CardTitle>
          <CardDescription>
            Performance metrics, volume, engagement, and delivery controls for active and past blasts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Mail className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="font-semibold text-gray-800 dark:text-gray-200">No campaigns launched yet</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
                Once you launch an email blast, real performance metrics and deliverability stats will appear here.
              </p>
              <Button asChild className="mt-4" size="sm">
                <Link href="/app/blast">
                  Launch Your First Campaign
                </Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="pb-3 pr-4">Campaign</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3 pr-4 text-right">Sent</th>
                    <th className="pb-3 pr-4 text-right">Delivered</th>
                    <th className="pb-3 pr-4 text-right">Bounced</th>
                    <th className="pb-3 pr-4 text-right">Bounce %</th>
                    <th className="pb-3 pr-4 text-right">Replied</th>
                    <th className="pb-3 pr-4 text-right">Unsub</th>
                    <th className="pb-3 pr-4 text-right">Complaint %</th>
                    <th className="pb-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {campaigns.map((c) => {
                    const bRate = calculateBounceRate(c.bounced, c.sent);
                    const isCriticalBounce = bRate > 3;
                    return (
                      <tr key={c.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                        <td className="py-4 pr-4 font-medium text-gray-900 dark:text-white">
                          {c.name}
                        </td>
                        <td className="py-4 pr-4">
                          <Badge
                            variant={
                              c.status === 'active'
                                ? 'success'
                                : c.status === 'paused'
                                ? 'warning'
                                : 'secondary'
                            }
                          >
                            {c.status}
                          </Badge>
                        </td>
                        <td className="py-4 pr-4 text-right text-gray-700 dark:text-gray-300">
                          {c.sent.toLocaleString()}
                        </td>
                        <td className="py-4 pr-4 text-right text-gray-700 dark:text-gray-300">
                          {c.delivered.toLocaleString()}
                        </td>
                        <td className="py-4 pr-4 text-right text-gray-700 dark:text-gray-300">
                          {c.bounced.toLocaleString()}
                        </td>
                        <td className="py-4 pr-4 text-right font-medium">
                          <span
                            className={
                              isCriticalBounce
                                ? 'text-red-600 dark:text-red-400 font-bold'
                                : 'text-gray-700 dark:text-gray-300'
                            }
                          >
                            {bRate}%
                          </span>
                        </td>
                        <td className="py-4 pr-4 text-right text-gray-700 dark:text-gray-300">
                          {c.replied.toLocaleString()}
                        </td>
                        <td className="py-4 pr-4 text-right text-gray-700 dark:text-gray-300">
                          {c.unsubscribed.toLocaleString()}
                        </td>
                        <td className="py-4 pr-4 text-right text-gray-700 dark:text-gray-300">
                          {calculateComplaintRate(c.complaints, c.sent)}
                        </td>
                        <td className="py-4 text-right">
                          {c.status !== 'completed' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => toggleCampaignStatus(c.id)}
                              className="h-8 text-xs rounded-lg"
                            >
                              {c.status === 'active' ? (
                                <>
                                  <Pause className="w-3.5 h-3.5 mr-1 text-yellow-600" />
                                  Pause
                                </>
                              ) : (
                                <>
                                  <Play className="w-3.5 h-3.5 mr-1 text-green-600" />
                                  Resume
                                </>
                              )}
                            </Button>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Domains Table */}
      <Card>
        <CardHeader>
          <CardTitle>Sending Domains &amp; Deliverability Health</CardTitle>
          <CardDescription>
            Domain sender reputation monitoring, bounce safeguards, and per-domain auto-pause rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {domains.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Globe className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="font-semibold text-gray-800 dark:text-gray-200">No sending domains connected</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
                Add your sending domains to monitor health scores, delivery rates, and auto-pause protection.
              </p>
              <Button asChild className="mt-4" size="sm">
                <Link href="/domains">
                  Add Sending Domain
                </Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="pb-3 pr-4">Domain</th>
                    <th className="pb-3 pr-4">Health</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3 pr-4 text-right">Sent</th>
                    <th className="pb-3 pr-4 text-right">Delivered</th>
                    <th className="pb-3 pr-4 text-right">Bounced</th>
                    <th className="pb-3 pr-4 text-right">Bounce %</th>
                    <th className="pb-3 pr-4 text-right">Replied</th>
                    <th className="pb-3 pr-4 text-right">Unsub</th>
                    <th className="pb-3 pr-4 text-right">Complaint %</th>
                    <th className="pb-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {domains.map((d) => {
                    const bRate = calculateBounceRate(d.bounced, d.sent);
                    const isHighBounce = bRate > 3;
                    return (
                      <tr key={d.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                        <td className="py-4 pr-4 font-medium text-gray-900 dark:text-white flex items-center gap-2">
                          <Globe className="w-4 h-4 text-gray-400" />
                          {d.name}
                        </td>
                        <td className="py-4 pr-4">
                          <HealthBadge health={d.health} />
                        </td>
                        <td className="py-4 pr-4">
                          <Badge variant={d.status === 'active' ? 'success' : 'warning'}>
                            {d.status}
                          </Badge>
                        </td>
                        <td className="py-4 pr-4 text-right text-gray-700 dark:text-gray-300">
                          {d.sent.toLocaleString()}
                        </td>
                        <td className="py-4 pr-4 text-right text-gray-700 dark:text-gray-300">
                          {d.delivered.toLocaleString()}
                        </td>
                        <td className="py-4 pr-4 text-right text-gray-700 dark:text-gray-300">
                          {d.bounced.toLocaleString()}
                        </td>
                        <td className="py-4 pr-4 text-right font-medium">
                          <span
                            className={
                              isHighBounce
                                ? 'text-red-600 dark:text-red-400 font-bold'
                                : 'text-gray-700 dark:text-gray-300'
                            }
                          >
                            {bRate}%
                          </span>
                        </td>
                        <td className="py-4 pr-4 text-right text-gray-700 dark:text-gray-300">
                          {d.replied.toLocaleString()}
                        </td>
                        <td className="py-4 pr-4 text-right text-gray-700 dark:text-gray-300">
                          {d.unsubscribed.toLocaleString()}
                        </td>
                        <td className="py-4 pr-4 text-right text-gray-700 dark:text-gray-300">
                          {calculateComplaintRate(d.complaints, d.sent)}
                        </td>
                        <td className="py-4 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleDomainStatus(d.id)}
                            className="h-8 text-xs rounded-lg"
                          >
                            {d.status === 'active' ? (
                              <>
                                <Pause className="w-3.5 h-3.5 mr-1 text-yellow-600" />
                                Pause
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5 mr-1 text-green-600" />
                                Resume
                              </>
                            )}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
