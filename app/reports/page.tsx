import { TrendingUp, CheckCircle, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

// Clean state: all metrics start at 0
const stats = [
  { label: 'Emails Sent (30d)', value: '0', change: '0%', up: true },
  { label: 'Avg Open Rate', value: '0.0%', change: '0.0%', up: true },
  { label: 'Avg Click Rate', value: '0.0%', change: '0.0%', up: true },
  { label: 'Bounce Rate', value: '0.0%', change: '0.0%', up: true },
];

interface TopCampaign {
  name: string;
  sent: number;
  openRate: number;
  clicks: number;
}

interface CleaningRecord {
  date: string;
  total: number;
  valid: number;
  invalid: number;
  disposable: number;
}

const topCampaigns: TopCampaign[] = [];
const cleaningHistory: CleaningRecord[] = [];

export default function ReportsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">Reports</h1>
        <p className="text-gray-500 dark:text-gray-400">
          Overview of your email sending performance and list health.
        </p>
      </div>

      {/* KPI Grid (Clean 0 Baseline) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-5 pb-5">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{stat.label}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
              <Badge variant="secondary" className="mt-2 text-xs">
                {stat.change}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Top Campaigns */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="w-4 h-4 text-gray-400" /> Top Campaigns
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topCampaigns.length === 0 ? (
            <div className="text-center py-8">
              <BarChart3 className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                No campaign data recorded
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
                Metrics will populate automatically once campaigns are sent and recipient engagement is recorded.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {topCampaigns.map((c) => (
                <div key={c.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-900 dark:text-white">{c.name}</span>
                    <span className="text-gray-500">{c.openRate}% open</span>
                  </div>
                  <Progress value={c.openRate} className="h-1.5" />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>{c.sent.toLocaleString()} sent</span>
                    <span>{c.clicks} clicks</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* List Cleaning History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle className="w-4 h-4 text-gray-400" /> List Cleaning History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cleaningHistory.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                No list cleaning history
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
                Clean your first CSV list in the Email List Cleaning tool to view historical cleaning reports.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {cleaningHistory.map((h) => (
                <div
                  key={h.date}
                  className="flex items-center gap-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-800"
                >
                  <div className="text-xs text-gray-400 w-24 shrink-0">{h.date}</div>
                  <div className="flex-1">
                    <Progress value={(h.valid / h.total) * 100} className="h-2" />
                  </div>
                  <div className="flex gap-3 text-xs shrink-0">
                    <span className="text-green-600">{h.valid.toLocaleString()} valid</span>
                    <span className="text-red-500">{h.invalid} invalid</span>
                    <span className="text-yellow-600">{h.disposable} disp.</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
