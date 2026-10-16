'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Send, Plus, MoreVertical, CheckCircle, Clock, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Campaign {
  id: string;
  name: string;
  subject: string;
  status: 'sent' | 'scheduled' | 'draft' | 'failed';
  recipients: number;
  openRate: number;
  sentAt: string;
}

// Clean state: 0 fake campaigns
const initialCampaigns: Campaign[] = [];

const statusConfig = {
  sent: { label: 'Sent', variant: 'success' as const, icon: CheckCircle },
  scheduled: { label: 'Scheduled', variant: 'warning' as const, icon: Clock },
  draft: { label: 'Draft', variant: 'secondary' as const, icon: Send },
  failed: { label: 'Failed', variant: 'destructive' as const, icon: XCircle },
};

export default function CampaignsPage() {
  const [campaigns] = useState<Campaign[]>(initialCampaigns);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">Campaigns</h1>
          <p className="text-gray-500 dark:text-gray-400">Manage all your email campaigns.</p>
        </div>
        <Button asChild>
          <Link href="/app/blast">
            <Plus className="w-4 h-4 mr-2" /> New Campaign
          </Link>
        </Button>
      </div>

      <div className="space-y-3">
        {campaigns.map((campaign) => {
          const config = statusConfig[campaign.status];
          const Icon = config.icon;
          return (
            <Card key={campaign.id}>
              <CardContent className="pt-5 pb-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-white truncate">
                        {campaign.name}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {campaign.subject}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                        <span>
                          {campaign.recipients > 0
                            ? `${campaign.recipients.toLocaleString()} recipients`
                            : 'No recipients yet'}
                        </span>
                        {campaign.status === 'sent' && (
                          <span>{campaign.openRate}% open rate</span>
                        )}
                        <span>{campaign.sentAt}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={config.variant}>{config.label}</Badge>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {campaigns.length === 0 && (
        <Card className="text-center py-16 px-4">
          <CardContent className="pt-6">
            <Send className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="text-lg font-semibold text-gray-800 dark:text-gray-200">No campaigns yet</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
              Create your first campaign with our Email Blast wizard to start reaching your audience.
            </p>
            <Button asChild className="mt-5">
              <Link href="/app/blast">
                <Plus className="w-4 h-4 mr-2" /> Create First Campaign
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
