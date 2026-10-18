'use client';
import { useState, useRef } from 'react';
import {
  Upload,
  Download,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Shield,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import Stepper from '@/components/layout/Stepper';
import {
  verifyEmails,
  computeStats,
  type VerificationResult,
  type CleaningStats,
} from '@/lib/services/emailVerification';

const steps = [{ label: 'Upload' }, { label: 'Verify' }, { label: 'Results' }];

export default function CleanPage() {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<VerificationResult[]>([]);
  const [stats, setStats] = useState<CleaningStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseCSV = (text: string): string[] => {
    const lines = text.split(/\r?\n/).filter(Boolean);
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const found: string[] = [];
    for (const line of lines) {
      const matches = line.match(emailRegex);
      if (matches) found.push(...matches);
    }
    return [...new Set(found)];
  };

  const handleFile = (f: File) => {
    setFile(f);
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length === 0) {
        setError('No valid email addresses found in the file.');
        return;
      }
      setEmails(parsed);
    };
    reader.readAsText(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const startVerification = async () => {
    setStep(1);
    setProgress(0);
    const interval = setInterval(
      () => setProgress((p) => Math.min(p + Math.random() * 15, 90)),
      300
    );
    try {
      const res = await verifyEmails(emails);
      clearInterval(interval);
      setProgress(100);
      setResults(res);
      setStats(computeStats(res));
      setTimeout(() => setStep(2), 500);
    } catch {
      clearInterval(interval);
      setError('Verification failed. Please try again.');
      setStep(0);
    }
  };

  const downloadClean = () => {
    const valid = results.filter((r) => r.status === 'valid').map((r) => r.email);
    const csv = 'email\n' + valid.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clean-list.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
          Email List Cleaning
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          Upload your CSV and we will verify every address.
        </p>
      </div>
      <Stepper steps={steps} currentStep={step} />

      {step === 0 && (
        <Card>
          <CardContent className="pt-6">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl p-12 flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
            >
              <Upload className="w-10 h-10 text-gray-400 mb-4" />
              <p className="text-gray-600 dark:text-gray-400 font-medium">
                {file ? file.name : 'Drop your CSV file here, or click to browse'}
              </p>
              <p className="text-xs text-gray-400 mt-1">Supports CSV with email addresses</p>
              {emails.length > 0 && (
                <Badge className="mt-3" variant="secondary">
                  {emails.length} emails found
                </Badge>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
            {emails.length > 0 && (
              <Button className="mobile-action-button w-full mt-4" onClick={startVerification}>
                Verify {emails.length} Emails
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-gray-400" />
            <p className="text-gray-600 dark:text-gray-400 font-medium">
              Verifying {emails.length} email addresses...
            </p>
            <Progress value={progress} className="w-full max-w-sm" />
            <p className="text-xs text-gray-400">{Math.round(progress)}% complete</p>
          </CardContent>
        </Card>
      )}

      {step === 2 && stats && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-6 flex items-center gap-4">
                <CheckCircle className="w-8 h-8 text-green-500" />
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.valid}</p>
                  <p className="text-sm text-gray-500">Valid</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 flex items-center gap-4">
                <XCircle className="w-8 h-8 text-red-500" />
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {stats.invalid}
                  </p>
                  <p className="text-sm text-gray-500">Invalid</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 flex items-center gap-4">
                <AlertTriangle className="w-8 h-8 text-yellow-500" />
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {stats.disposable}
                  </p>
                  <p className="text-sm text-gray-500">Disposable</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 flex items-center gap-4">
                <Shield className="w-8 h-8 text-orange-500" />
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.risky}</p>
                  <p className="text-sm text-gray-500">Risky / Catch-all</p>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-500">Clean rate</span>
                <span className="text-sm font-semibold">
                  {Math.round((stats.valid / stats.total) * 100)}%
                </span>
              </div>
              <Progress value={(stats.valid / stats.total) * 100} />
            </CardContent>
          </Card>
          <div className="flex gap-3">
            <Button onClick={downloadClean} className="flex-1">
              <Download className="w-4 h-4 mr-2" /> Download Clean CSV ({stats.valid} emails)
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setStep(0);
                setFile(null);
                setEmails([]);
                setResults([]);
                setStats(null);
              }}
            >
              Start Over
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
