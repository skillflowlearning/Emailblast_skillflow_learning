'use client';
import { useState } from 'react';
import { Globe, Plus, Trash2, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { type Domain } from '@/lib/services/emailBlast';

// Clean state: 0 fake domains
const initialDomains: Domain[] = [];

export default function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>(initialDomains);
  const [newName, setNewName] = useState('');
  const [newLimit, setNewLimit] = useState('50');

  const addDomain = () => {
    if (!newName.trim()) return;
    setDomains((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        name: newName.trim(),
        dailyLimit: parseInt(newLimit) || 50,
        sent: 0,
        status: 'active',
      },
    ]);
    setNewName('');
    setNewLimit('50');
  };

  const removeDomain = (id: string) => setDomains((prev) => prev.filter((d) => d.id !== id));

  const toggleStatus = (id: string) => {
    setDomains((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, status: d.status === 'active' ? 'paused' : 'active' } : d
      )
    );
  };

  const resetSent = (id: string) => {
    setDomains((prev) => prev.map((d) => (d.id === id ? { ...d, sent: 0 } : d)));
  };

  const totalSent = domains.reduce((s, d) => s + d.sent, 0);
  const totalCapacity = domains.reduce((s, d) => s + d.dailyLimit, 0);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
          Sending Domains
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          Manage your sending infrastructure and daily limits.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-5 text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{domains.length}</p>
            <p className="text-xs text-gray-500 mt-1">Total Domains</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-5 text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalSent.toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-1">Sent Today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-5 text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {Math.max(0, totalCapacity - totalSent).toLocaleString()}
            </p>
            <p className="text-xs text-gray-500 mt-1">Remaining Today</p>
          </CardContent>
        </Card>
      </div>

      {/* Domain List */}
      <div className="space-y-3">
        {domains.map((domain) => {
          const usePct = domain.dailyLimit > 0 ? Math.round((domain.sent / domain.dailyLimit) * 100) : 0;
          return (
            <Card key={domain.id}>
              <CardContent className="pt-5 pb-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="font-semibold text-gray-900 dark:text-white text-sm">
                      {domain.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={domain.status === 'active' ? 'success' : 'secondary'}
                      className="cursor-pointer"
                      onClick={() => toggleStatus(domain.id)}
                    >
                      {domain.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-gray-400 hover:text-blue-500"
                      title="Reset daily counter"
                      onClick={() => resetSent(domain.id)}
                    >
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-gray-400 hover:text-red-500"
                      onClick={() => removeDomain(domain.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>
                      {domain.sent.toLocaleString()} / {domain.dailyLimit.toLocaleString()} sent today
                    </span>
                    <span>{usePct}%</span>
                  </div>
                  <Progress value={usePct} className={usePct >= 100 ? 'opacity-60' : ''} />
                </div>
                {usePct >= 100 && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-yellow-600 dark:text-yellow-400">
                    <AlertTriangle className="w-3 h-3" />
                    Daily limit reached. Reset the counter or increase your limit.
                  </div>
                )}
                {usePct < 100 && domain.status === 'active' && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-green-600 dark:text-green-400">
                    <CheckCircle className="w-3 h-3" />
                    {(domain.dailyLimit - domain.sent).toLocaleString()} emails remaining today.
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {domains.length === 0 && (
          <Card className="text-center py-10 px-4">
            <CardContent>
              <Globe className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="font-semibold text-gray-800 dark:text-gray-200">No sending domains connected</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
                Add your domain below to configure daily send limits and warmup throttling.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add Domain */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add New Domain</CardTitle>
          <CardDescription>Add a sending domain and configure its safe daily limit.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Domain Name</Label>
              <Input
                placeholder="e.g. mail.yourdomain.com"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-36 space-y-1">
              <Label className="text-xs">Daily Limit (Max 50/day)</Label>
              <Input
                type="number"
                placeholder="50"
                value={newLimit}
                onChange={(e) => setNewLimit(e.target.value)}
              />
            </div>
          </div>
          <Button className="w-full" onClick={addDomain} disabled={!newName.trim()}>
            <Plus className="w-4 h-4 mr-2" /> Add Domain
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
