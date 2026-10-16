'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Campaign } from '@/lib/types/blast';
import { api } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]); const [error, setError] = useState('');
  useEffect(() => { const load = () => api<{ campaigns: Campaign[] }>('/api/campaigns').then((result) => setCampaigns(result.campaigns)).catch((error) => setError(error.message)); load(); const timer = setInterval(load, 5000); return () => clearInterval(timer); }, []);
  return <div className="max-w-4xl mx-auto space-y-5"><div className="flex justify-between items-center"><h1 className="text-3xl font-bold">Saved campaigns</h1><Button asChild><Link href="/app/blast">New campaign</Link></Button></div>
    <p className="text-gray-500">Campaigns and progress are saved on the server. Open a campaign to continue monitoring it.</p>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {!campaigns.length && <Card><CardContent className="pt-6">No saved campaigns yet. Create a simulation to test the background worker.</CardContent></Card>}
    {campaigns.map((campaign) => <Card key={campaign.id}><CardContent className="pt-6 flex flex-wrap justify-between items-center gap-3"><div><h2 className="font-semibold">{campaign.name}</h2><p className="text-sm text-gray-500">{campaign.subject}</p><p className="text-xs text-gray-400 mt-2">{campaign.sentCount} sent · {campaign.pendingCount} pending · {campaign.providerMode}</p></div><div className="flex gap-2 items-center"><Badge variant="outline">{campaign.status.replace('_', ' ')}</Badge><Button variant="outline" asChild><Link href={`/app/blast?campaign=${encodeURIComponent(campaign.id)}`}>Open campaign</Link></Button></div></CardContent></Card>)}
  </div>;
}
