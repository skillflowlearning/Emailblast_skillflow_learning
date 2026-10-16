'use client';
import { useState, useRef, useMemo } from 'react';
import Link from 'next/link';
import Papa from 'papaparse';
import {
  Send,
  ChevronRight,
  ChevronLeft,
  Calendar,
  ListFilter,
  FileText,
  Globe,
  Clock,
  ShieldCheck,
  Plus,
  Upload,
  X,
  Download,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  AlertCircle,
  Mail,
  ShieldAlert,
  Sliders,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import Stepper from '@/components/layout/Stepper';
import { BLAST_CONFIG } from '@/lib/config/blastConfig';
import {
  Campaign,
  Recipient,
  BlastDomain,
  BlastMailbox,
} from '@/lib/types/blast';
import { blastEngine } from '@/lib/services/blastEngine';
import { isSuppressed } from '@/lib/services/suppression';
import LiveCampaignView from '@/components/blast/LiveCampaignView';

const steps = [
  { label: 'Recipients' },
  { label: 'Message' },
  { label: 'Mailboxes' },
  { label: 'Schedule' },
  { label: 'Confirm' },
];

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export default function BlastPage() {
  const [step, setStep] = useState(0);

  // ── Step 1: Recipients State ──────────────────────────────────────────
  const [rawEmailsText, setRawEmailsText] = useState('');
  const [fileRawRows, setFileRawRows] = useState<string[]>([]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [csvParsedRows, setCsvParsedRows] = useState<Record<string, string>[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showInvalidList, setShowInvalidList] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Step 2: Message State ─────────────────────────────────────────────
  const [campaignName, setCampaignName] = useState('Product Launch Outreach');
  const [subject, setSubject] = useState('Quick question regarding your email infrastructure, {{name}}');
  const [body, setBody] = useState(
    `Hi {{name}},\n\nI noticed your recent work in email infrastructure and wanted to connect.\n\nWe help companies keep deliverability above 99% using automated mailbox warming, rate-limiting, and seed placement checks.\n\nWould you have 10 minutes for a brief chat this week?\n\nBest regards,`
  );
  const [senderName, setSenderName] = useState('Alex Rivera');
  const [businessAddress, setBusinessAddress] = useState('100 Innovation Way, Suite 400, San Francisco, CA 94105');
  const [optOutLine, setOptOutLine] = useState("To unsubscribe, reply 'STOP' or click here: [Unsubscribe]");

  // ── Step 3: Mailboxes & Domains State (3 domains x 3 mailboxes + 1 spare)
  const [domains, setDomains] = useState<BlastDomain[]>(() =>
    BLAST_CONFIG.DEFAULT_DOMAINS.map((d) => ({
      ...d,
      flaggedMailboxCount: 0,
    }))
  );

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

  const [enableRamp, setEnableRamp] = useState(true);
  const [rampPercent, setRampPercent] = useState(BLAST_CONFIG.DEFAULT_RAMP_PERCENT);
  const [windowStart, setWindowStart] = useState(BLAST_CONFIG.DEFAULT_SENDING_WINDOW.start);
  const [windowEnd, setWindowEnd] = useState(BLAST_CONFIG.DEFAULT_SENDING_WINDOW.end);
  const [newDomainName, setNewDomainName] = useState('');

  // ── Step 5: Confirm & Launch State ────────────────────────────────────
  const [providerMode, setProviderMode] = useState<'simulation' | 'live'>(
    BLAST_CONFIG.PROVIDER_MODE || 'simulation'
  );
  const [testEmail, setTestEmail] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    messageId?: string;
    mode?: string;
    notice?: string;
    error?: string;
  } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [activeCampaignData, setActiveCampaignData] = useState<{
    campaign: Campaign;
    recipients: Recipient[];
    domains: BlastDomain[];
    mailboxes: BlastMailbox[];
  } | null>(null);

  // ── Helper: Download Sample CSV ───────────────────────────────────────
  const handleDownloadSampleCSV = () => {
    const csvContent =
      'name,email\nJohn Doe,john.doe@example.com\nSarah Connor,sarah.connor@acme-corp.com\nAlex Rivera,alex.rivera@innovate.org\nElena Rostova,elena@fintech-global.io\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_recipients.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ── Helper: CSV File Parser ───────────────────────────────────────────
  const processUploadedFile = (file: File) => {
    setFileError(null);

    if (file.size > BLAST_CONFIG.MAX_FILE_SIZE_BYTES) {
      setFileError('File size exceeds the 5 MB limit. Please upload a smaller file.');
      return;
    }

    const isCSV = file.name.endsWith('.csv');
    const isTXT = file.name.endsWith('.txt');

    if (!isCSV && !isTXT) {
      setFileError('Unsupported file type. Please upload a .csv or .txt file.');
      return;
    }

    setUploadedFile(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text || !text.trim()) {
        setFileError('The uploaded file is empty.');
        return;
      }

      if (isTXT) {
        const rawLines = text
          .split(/[\r\n,;]+/)
          .map((line) => line.trim())
          .filter(Boolean);
        setFileRawRows(rawLines);
        setCsvHeaders([]);
        setSelectedColumn(null);
        setCsvParsedRows([]);
        return;
      }

      Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: 'greedy',
        complete: (results) => {
          const fields = results.meta.fields || [];
          const rows = results.data;

          if (rows.length === 0) {
            setFileError('No data rows found in this CSV.');
            return;
          }

          setCsvParsedRows(rows);
          setCsvHeaders(fields);

          // Auto-detect email column
          const detectedByHeader = fields.find((h) =>
            /^(email|e-mail|mail|email_address|emailaddress|recipient|contact_email)$/i.test(h.trim())
          );

          const detectedByContent = fields.find((h) =>
            rows.slice(0, 20).some((r) => r[h] && EMAIL_REGEX.test(r[h].trim()))
          );

          const autoDetected = detectedByHeader || detectedByContent || fields[0] || null;
          setSelectedColumn(autoDetected);

          if (autoDetected) {
            const extracted = rows
              .map((r) => r[autoDetected])
              .filter(Boolean)
              .map((v) => String(v).trim());
            setFileRawRows(extracted);
          } else {
            setFileRawRows([]);
          }
        },
        error: (err: Error) => {
          setFileError(`Failed to parse CSV: ${err.message}`);
        },
      });
    };
    reader.readAsText(file);
  };

  const handleColumnSelect = (col: string) => {
    setSelectedColumn(col);
    if (csvParsedRows.length > 0 && col) {
      const extracted = csvParsedRows
        .map((r) => r[col])
        .filter(Boolean)
        .map((v) => String(v).trim());
      setFileRawRows(extracted);
    }
  };

  const handleRemoveFile = () => {
    setUploadedFile(null);
    setFileRawRows([]);
    setFileError(null);
    setCsvHeaders([]);
    setSelectedColumn(null);
    setCsvParsedRows([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Drag & Drop Handlers ──────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processUploadedFile(file);
  };

  // ── Recipient Parsing, De-duplication, & Syntax Validation ────────────
  /**
   * TODO: Email verification API integration.
   * Currently performing syntax validation + duplicate removal + suppression checks only.
   * Real MX/SMTP ping verification will be plugged in via verification API.
   */
  const { totalRawRows, validRecipients, duplicateCount, invalidRecipients } = useMemo(() => {
    const textareaTokens = rawEmailsText
      .split(/[\r\n,;\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const combinedRaw = [...fileRawRows, ...textareaTokens];

    const seen = new Set<string>();
    const valid: { email: string; name?: string }[] = [];
    const invalid: string[] = [];
    let dupes = 0;

    for (const raw of combinedRaw) {
      const lower = raw.toLowerCase().trim();
      if (!lower) continue;

      if (!EMAIL_REGEX.test(lower)) {
        invalid.push(raw);
        continue;
      }

      if (seen.has(lower)) {
        dupes++;
      } else {
        seen.add(lower);
        // Try to find matching name from parsed CSV if available
        let recipientName = '';
        if (csvParsedRows.length > 0 && selectedColumn) {
          const matchRow = csvParsedRows.find(
            (r) => r[selectedColumn]?.toLowerCase().trim() === lower
          );
          if (matchRow) {
            const nameField = Object.keys(matchRow).find((k) =>
              /^(name|first_name|firstname|full_name|fullname|contact)$/i.test(k)
            );
            if (nameField && matchRow[nameField]) {
              recipientName = matchRow[nameField].trim();
            }
          }
        }

        valid.push({
          email: lower,
          name: recipientName || undefined,
        });
      }
    }

    return {
      totalRawRows: combinedRaw.length,
      validRecipients: valid,
      duplicateCount: dupes,
      invalidRecipients: invalid,
    };
  }, [fileRawRows, rawEmailsText, csvParsedRows, selectedColumn]);

  const isOverMaxLimit = totalRawRows > BLAST_CONFIG.MAX_RECIPIENTS;

  // ── Mailbox Capacity Management ───────────────────────────────────────
  const handleDailyCapChange = (mailboxId: string, value: number) => {
    // HARD MAX 50: constant enforced in code, UI can never exceed it!
    const clamped = Math.min(
      BLAST_CONFIG.HARD_MAX_MAILBOX_DAILY_CAP,
      Math.max(1, value)
    );
    setMailboxes((prev) =>
      prev.map((m) => (m.id === mailboxId ? { ...m, dailyCap: clamped } : m))
    );
  };

  const handleToggleMailboxActive = (mailboxId: string) => {
    setMailboxes((prev) =>
      prev.map((m) => {
        if (m.id !== mailboxId) return m;
        const nextStatus = m.status === 'active' ? 'paused' : 'active';
        return { ...m, status: nextStatus };
      })
    );
  };

  const handleAddDomain = () => {
    if (!newDomainName.trim()) return;
    const cleanName = newDomainName.trim().toLowerCase();
    const newDomainId = `dom-${Date.now()}`;

    setDomains((prev) => [
      ...prev,
      {
        id: newDomainId,
        name: cleanName,
        status: 'active',
        flaggedMailboxCount: 0,
      },
    ]);

    // Automatically add 1 active mailbox for this domain
    setMailboxes((prev) => [
      ...prev,
      {
        id: `mbx-${Date.now()}`,
        email: `outreach@${cleanName}`,
        displayName: `Outreach (${cleanName})`,
        domainId: newDomainId,
        dailyCap: BLAST_CONFIG.DEFAULT_MAILBOX_DAILY_CAP,
        sentToday: 0,
        status: 'active',
        totalSent: 0,
        bouncesCount: 0,
        bounceRate: 0,
        recentSeedPlacements: [],
        assignedRecipientCount: 0,
      },
    ]);

    setNewDomainName('');
  };

  // ── Recipient Distribution & ETA Calculation ──────────────────────────
  const activeMailboxes = mailboxes.filter((m) => m.status === 'active');
  const totalFleetDailyCap = activeMailboxes.reduce((sum, m) => sum + m.dailyCap, 0);

  const { etaDescription, daysNeeded } = blastEngine.computeScheduleETA(
    validRecipients.length,
    mailboxes
  );

  // ── Step 5: Test Send Handler ─────────────────────────────────────────
  const handleTestSend = async () => {
    if (!testEmail || !testEmail.includes('@')) {
      setTestResult({ success: false, error: 'Please enter a valid recipient email for the test send.' });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/blast/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmail: testEmail.trim(),
          fromEmail: activeMailboxes[0]?.email || 'alex@mail.acme-sales.com',
          fromName: activeMailboxes[0]?.displayName || senderName,
          subject,
          content: body,
          senderName,
          businessAddress,
          optOutLine,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setTestResult({ success: false, error: data.error || 'Test send failed.' });
      } else {
        setTestResult({
          success: true,
          messageId: data.messageId,
          mode: data.mode,
          notice: data.notice,
        });
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err.message || 'Network error during test send.' });
    } finally {
      setIsTesting(false);
    }
  };

  // ── Step 5: Start Campaign Execution ──────────────────────────────────
  const handleStartCampaign = async () => {
    setStartError(null);

    if (!consent) {
      setStartError('Please confirm the compliance consent checkbox to continue.');
      return;
    }
    if (validRecipients.length === 0) {
      setStartError('No valid recipients found. Please upload or paste contacts.');
      return;
    }
    if (activeMailboxes.length === 0) {
      setStartError('No active mailboxes configured. At least one active mailbox is required.');
      return;
    }

    // Live mode safety constraints
    if (providerMode === 'live') {
      if (!senderName.trim() || !businessAddress.trim() || !optOutLine.trim()) {
        setStartError(
          'CAN-SPAM Compliance Error: Sender Name, Physical Business Address, and Opt-Out Line are mandatory for Live campaigns.'
        );
        return;
      }

      // Check server-side credentials
      try {
        const statusRes = await fetch('/api/blast/worker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status' }),
        });
        const statusData = await statusRes.json();
        if (!statusData.canRunLive) {
          setStartError(
            'Live Mode Requires Credentials: Missing Google Workspace Service Account credentials (GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) with domain-wide delegation or SMTP fallback credentials in .env.local. Refusing to start live campaign.'
          );
          return;
        }
        if (statusData.providerMode !== 'live' || !statusData.seedEmails?.length) {
          setStartError('Live campaigns require BLAST_PROVIDER_MODE=live and BLAST_SEED_EMAILS configured on the server.');
          return;
        }
      } catch {
        // Fallback safety refusal if server cannot confirm credentials
        setStartError('Could not verify server credentials for Live Mode. Please check .env.local.');
        return;
      }
    }

    // Build recipient records
    const recipientRecords: Recipient[] = validRecipients.map((v, i) => ({
      id: `rec-${i + 1}`,
      email: v.email,
      name: v.name,
      status: 'pending',
    }));

    // Distribute recipients equally across active mailboxes
    const { updatedRecipients, updatedMailboxes } = blastEngine.distributeRecipients(
      recipientRecords,
      mailboxes
    );

    const fullCampaign: Campaign = {
      id: `camp-${Date.now()}`,
      name: campaignName.trim() || 'Email Blast Campaign',
      subject: subject.trim(),
      body: body.trim(),
      senderName: senderName.trim(),
      businessAddress: businessAddress.trim(),
      optOutText: optOutLine.trim(),
      sendingWindow: {
        start: windowStart,
        end: windowEnd,
        timeZone: 'Asia/Kolkata',
      },
      enableRamp,
      rampPercent,
      status: 'running',
      totalRecipients: updatedRecipients.length,
      sentCount: 0,
      bouncedCount: 0,
      pendingCount: updatedRecipients.length,
      skippedCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      providerMode,
    };

    setActiveCampaignData({
      campaign: fullCampaign,
      recipients: updatedRecipients,
      domains,
      mailboxes: updatedMailboxes,
    });
  };

  // ── If Live Campaign is running, show LiveCampaignView ────────────────
  if (activeCampaignData) {
    return (
      <LiveCampaignView
        initialCampaign={activeCampaignData.campaign}
        initialRecipients={activeCampaignData.recipients}
        initialDomains={activeCampaignData.domains}
        initialMailboxes={activeCampaignData.mailboxes}
        onReset={() => {
          setActiveCampaignData(null);
          setStep(0);
          setConsent(false);
          setRawEmailsText('');
          handleRemoveFile();
        }}
      />
    );
  }

  // ── Live Message Preview with Personalization & Footer ────────────────
  const previewName = 'Sarah Connor';
  const previewBody = body.replace(/\{\{name\}\}/gi, previewName);
  const previewSubject = subject.replace(/\{\{name\}\}/gi, previewName);

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      <div>
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white tracking-tight mb-2">
          Email Blast
        </h1>
        <p className="text-gray-500 dark:text-gray-400 font-light">
          Slow, distributed sending across warm mailboxes with real-time seed checks, automated bounce failover, and reputation protection.
        </p>
      </div>

      <Stepper steps={steps} currentStep={step} />

      {/* ── STEP 1: RECIPIENTS ────────────────────────────────────────── */}
      {step === 0 && (
        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListFilter className="w-5 h-5 text-gray-400" />
              Step 1: Recipients
            </CardTitle>
            <CardDescription>
              Upload a CSV or paste email addresses. Max 5 MB &bull; Up to 10,000 contacts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isOverMaxLimit && (
              <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm text-red-900 dark:text-red-200">
                    Recipient Limit Exceeded
                  </p>
                  <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                    Your input contains {totalRawRows.toLocaleString()} rows. Maximum allowed per blast is 10,000 emails.
                  </p>
                </div>
              </div>
            )}

            {fileError && (
              <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 dark:text-red-300">{fileError}</p>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* CSV Upload */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Upload Contact File (.csv, .txt)</Label>
                  <button
                    type="button"
                    onClick={handleDownloadSampleCSV}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-medium"
                  >
                    <Download className="w-3 h-3" /> Download sample CSV
                  </button>
                </div>

                {!uploadedFile ? (
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-3xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all min-h-[220px] ${
                      isDragging
                        ? 'border-gray-900 dark:border-white bg-gray-100 dark:bg-gray-800'
                        : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 hover:border-gray-400 dark:hover:border-gray-600'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.txt"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) processUploadedFile(f);
                      }}
                    />
                    <Upload className="w-8 h-8 text-gray-400 mb-2" />
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      Drag &amp; drop your CSV or TXT here
                    </p>
                    <p className="text-xs text-gray-500 mt-1 mb-4">
                      Max 5 MB &bull; Up to 10,000 contacts
                    </p>
                    <Button type="button" variant="outline" size="sm" className="rounded-xl pointer-events-none">
                      Choose file
                    </Button>
                  </div>
                ) : (
                  <div className="p-5 rounded-3xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                          <FileSpreadsheet className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                            {uploadedFile.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {(uploadedFile.size / 1024).toFixed(1)} KB &bull; {fileRawRows.length} rows loaded
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleRemoveFile}
                        className="h-8 w-8 text-gray-400 hover:text-red-500 rounded-full"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>

                    {csvHeaders.length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-gray-200 dark:border-gray-700">
                        <Label htmlFor="columnSelect" className="text-xs text-gray-600 dark:text-gray-400">
                          Auto-Detected Email Column:
                        </Label>
                        <select
                          id="columnSelect"
                          value={selectedColumn || ''}
                          onChange={(e) => handleColumnSelect(e.target.value)}
                          className="w-full text-xs h-9 rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 px-3 py-1 font-medium text-gray-900 dark:text-white focus:outline-none"
                        >
                          {csvHeaders.map((h) => (
                            <option key={h} value={h}>
                              Column: {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Paste Textarea */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="recipientsText">Or Paste / Type Emails</Label>
                  <span className="text-xs text-gray-400">One per line or comma-separated</span>
                </div>
                <Textarea
                  id="recipientsText"
                  rows={8}
                  placeholder="john@example.com&#10;sarah@company.org&#10;alex@domain.io"
                  value={rawEmailsText}
                  onChange={(e) => setRawEmailsText(e.target.value)}
                  className="font-sans min-h-[220px]"
                />
              </div>
            </div>

            {/* Metrics Breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 text-center">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Total Rows</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                  {totalRawRows.toLocaleString()}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-green-50/50 dark:bg-green-950/20 border border-green-100 dark:border-green-900/30 text-center">
                <p className="text-xs text-green-700 dark:text-green-400 uppercase tracking-wider font-semibold">Valid</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
                  {validRecipients.length.toLocaleString()}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 text-center">
                <p className="text-xs text-amber-700 dark:text-amber-400 uppercase tracking-wider font-semibold">Duplicates</p>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                  {duplicateCount.toLocaleString()}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-red-50/50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 text-center">
                <p className="text-xs text-red-700 dark:text-red-400 uppercase tracking-wider font-semibold">Invalid</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
                  {invalidRecipients.length.toLocaleString()}
                </p>
              </div>
            </div>

            {invalidRecipients.length > 0 && (
              <div className="border border-red-200 dark:border-red-900/40 rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowInvalidList(!showInvalidList)}
                  className="w-full px-4 py-2.5 bg-red-50/60 dark:bg-red-950/30 text-left text-xs font-semibold text-red-700 dark:text-red-300 flex items-center justify-between"
                >
                  <span>⚠️ {invalidRecipients.length} invalid email format(s) excluded</span>
                  {showInvalidList ? <ChevronUp className="w-4 h-4 text-red-500" /> : <ChevronDown className="w-4 h-4 text-red-500" />}
                </button>
                {showInvalidList && (
                  <div className="p-3 bg-red-50/20 dark:bg-red-950/10 max-h-36 overflow-y-auto font-mono text-xs text-red-600 dark:text-red-400 space-y-1">
                    {invalidRecipients.slice(0, 50).map((inv, idx) => (
                      <div key={idx} className="truncate">&bull; {inv}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                onClick={() => setStep(1)}
                disabled={validRecipients.length === 0 || isOverMaxLimit}
                className="min-w-[140px]"
              >
                Continue ({validRecipients.length}) <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 2: MESSAGE (ONE subject + ONE plain text body + live preview) ── */}
      {step === 1 && (
        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-gray-400" />
              Step 2: Message &amp; Compliance Footer
            </CardTitle>
            <CardDescription>
              Write your subject and plain-text body with <code>{"{{name}}"}</code> personalization. Physical address and opt-out lines are automatically appended for CAN-SPAM compliance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Note on Postponed AI Template Writer Feature */}
            {/* TODO: Postponed AI Template Writer feature. Feature deferred as requested. */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="campaignName">Campaign Name (Internal)</Label>
                <Input
                  id="campaignName"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="e.g. Q4 Sales Outreach"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="subject">Subject Line</Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Quick question for {{name}}"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="body">Email Body (Plain Text)</Label>
                <Textarea
                  id="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  className="font-sans"
                />
                <p className="text-xs text-gray-400">
                  Use <code>{"{{name}}"}</code> to insert the recipient&apos;s name dynamically.
                </p>
              </div>

              {/* Compliance Footer Fields */}
              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Mandatory Compliance Footer (Editable)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="senderName" className="text-xs">Sender Name</Label>
                    <Input
                      id="senderName"
                      value={senderName}
                      onChange={(e) => setSenderName(e.target.value)}
                      className="text-xs h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="businessAddress" className="text-xs">Physical Postal Address</Label>
                    <Input
                      id="businessAddress"
                      value={businessAddress}
                      onChange={(e) => setBusinessAddress(e.target.value)}
                      className="text-xs h-9"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="optOutLine" className="text-xs">Opt-Out / Unsubscribe Line</Label>
                  <Input
                    id="optOutLine"
                    value={optOutLine}
                    onChange={(e) => setOptOutLine(e.target.value)}
                    className="text-xs h-9"
                  />
                </div>
              </div>

              {/* Live Preview Box */}
              <div className="p-5 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60 space-y-3">
                <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-2">
                  <span className="text-xs font-semibold uppercase text-gray-400">
                    Live Email Preview (Sample Recipient: {previewName})
                  </span>
                  <Badge variant="outline" className="text-[10px]">Plain Text</Badge>
                </div>

                <div className="space-y-1 text-sm">
                  <p className="font-semibold text-gray-900 dark:text-white">
                    Subject: {previewSubject}
                  </p>
                  <div className="text-gray-700 dark:text-gray-300 whitespace-pre-line pt-2 text-xs sm:text-sm">
                    {previewBody}
                  </div>
                  <div className="pt-4 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400 italic">
                    <p>{senderName}</p>
                    <p>{businessAddress}</p>
                    <p className="underline pt-1">{optOutLine}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(0)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button
                onClick={() => setStep(2)}
                disabled={!subject.trim() || !body.trim() || !senderName.trim() || !businessAddress.trim()}
              >
                Continue <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 3: MAILBOXES & DOMAINS FLEET ─────────────────────────── */}
      {step === 2 && (
        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-gray-400" />
              Step 3: Mailboxes &amp; Domains Fleet
            </CardTitle>
            <CardDescription>
              Sending is partitioned across healthy mailboxes. Default demo fleet: 3 domains &times; 3 mailboxes + 1 spare mailbox.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Sending Window & Ramp Configuration */}
            <div className="p-4 sm:p-5 rounded-2xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Sending Window &amp; Warmup Ramp
                </span>
                <Badge variant="outline" className="text-xs">
                  Hard Max 50/day per mailbox
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Window Start</Label>
                  <Input
                    type="time"
                    value={windowStart}
                    onChange={(e) => setWindowStart(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Window End</Label>
                  <Input
                    type="time"
                    value={windowEnd}
                    onChange={(e) => setWindowEnd(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Daily Ramp (+% / healthy day)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={10}
                      max={20}
                      value={rampPercent}
                      onChange={(e) =>
                        setRampPercent(
                          Math.min(20, Math.max(10, parseInt(e.target.value) || 15))
                        )
                      }
                      className="h-8 text-xs w-20"
                    />
                    <span className="text-xs text-gray-400">+10-20% ramp</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Add Custom Domain */}
            <div className="flex gap-2">
              <Input
                placeholder="Add sending domain (e.g. mail.acme-sales.com)"
                value={newDomainName}
                onChange={(e) => setNewDomainName(e.target.value)}
                className="h-9 text-xs sm:text-sm"
              />
              <Button
                variant="outline"
                onClick={handleAddDomain}
                disabled={!newDomainName.trim()}
                className="h-9 text-xs shrink-0"
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Domain
              </Button>
            </div>

            {/* Mailboxes Grouped by Domain */}
            <div className="space-y-4">
              {domains.map((dom) => {
                const domMailboxes = mailboxes.filter((m) => m.domainId === dom.id);
                return (
                  <div
                    key={dom.id}
                    className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-3 bg-white dark:bg-gray-800/40"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-gray-400" />
                        <span className="font-semibold text-sm text-gray-900 dark:text-white">
                          {dom.name}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {domMailboxes.length} mailboxes
                        </Badge>
                      </div>
                      <Badge variant="success" className="text-[10px]">Active</Badge>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {domMailboxes.map((mbx) => (
                        <div
                          key={mbx.id}
                          className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700/60 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-1">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-900 dark:text-white truncate">
                                {mbx.displayName}
                              </p>
                              <p className="text-[10px] text-gray-400 truncate">{mbx.email}</p>
                            </div>
                            <Badge
                              variant={
                                mbx.status === 'active'
                                  ? 'success'
                                  : mbx.status === 'spare'
                                  ? 'secondary'
                                  : 'destructive'
                              }
                              className="text-[9px] px-1.5 py-0"
                            >
                              {mbx.status}
                            </Badge>
                          </div>

                          <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-200 dark:border-gray-700">
                            <span className="text-[11px] text-gray-500">Daily Cap:</span>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min={1}
                                max={50}
                                value={mbx.dailyCap}
                                onChange={(e) =>
                                  handleDailyCapChange(mbx.id, parseInt(e.target.value) || 30)
                                }
                                className="w-14 h-6 text-xs text-center p-0"
                              />
                              <span className="text-[10px] text-gray-400">/ 50 max</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Split Distribution Preview */}
            <div className="p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-900/20 text-xs sm:text-sm text-blue-900 dark:text-blue-300 space-y-1.5">
              <div className="flex justify-between font-medium">
                <span>Active Mailbox Fleet:</span>
                <span>{activeMailboxes.length} active mailboxes</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Total Fleet Daily Capacity:</span>
                <span>{totalFleetDailyCap} emails/day</span>
              </div>
              <div className="flex justify-between text-xs text-blue-700 dark:text-blue-400 pt-1 border-t border-blue-200/50 dark:border-blue-800/50">
                <span>Allocation per active mailbox:</span>
                <span>
                  &asymp; {Math.ceil(validRecipients.length / (activeMailboxes.length || 1))} emails assigned
                </span>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={activeMailboxes.length === 0}
              >
                Continue <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 4: SCHEDULE & ETA CALCULATION ─────────────────────────── */}
      {step === 3 && (
        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-gray-400" />
              Step 4: Schedule &amp; Safe Pacing
            </CardTitle>
            <CardDescription>
              Sending is NEVER instant. Emails are batched in groups of 10&ndash;15 with 30&ndash;120s random gaps to mirror human behavior.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="p-5 rounded-2xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Computed Delivery ETA
                </span>
                <Badge variant="outline" className="text-xs">
                  {daysNeeded === 1 ? 'Completes Today' : `${daysNeeded} Days Required`}
                </Badge>
              </div>

              <div className="space-y-2">
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {etaDescription}
                </p>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Daily sending capacity of your fleet is {totalFleetDailyCap} emails ({activeMailboxes.length} active mailboxes &times; daily caps). If the list exceeds today&apos;s capacity, unsent emails automatically spill over to subsequent days during the configured {windowStart}&ndash;{windowEnd} window.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase">Batch Rhythm</p>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  10&ndash;15 emails / batch &bull; 30&ndash;120s random gap
                </p>
                <p className="text-xs text-gray-400">
                  Prevents ESP burst-detection flags on Google, Microsoft, and Yahoo.
                </p>
              </div>

              <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase">Seed Probe Interval</p>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  Seed check dispatched every ~11th email
                </p>
                <p className="text-xs text-gray-400">
                  Rotates through 6&ndash;8 seed addresses. Evaluates inbox vs spam placement.
                </p>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button onClick={() => setStep(4)}>
                Review &amp; Confirm <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 5: CONFIRM & START ────────────────────────────────────── */}
      {step === 4 && (
        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-gray-400" />
              Step 5: Review &amp; Compliance Consent
            </CardTitle>
            <CardDescription>
              Confirm campaign details, auto-rules safeguards, and anti-spam compliance consent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Provider Mode Selection */}
            <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Sending Engine Mode
                  </p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mt-0.5">
                    {providerMode === 'simulation' ? 'Simulation Sandbox (No Real Emails Sent)' : 'Live Google Workspace (Gmail API & SMTP Fallback)'}
                  </p>
                </div>
                <Badge variant={providerMode === 'live' ? 'destructive' : 'secondary'} className="capitalize">
                  {providerMode}
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setProviderMode('simulation');
                    setStartError(null);
                  }}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    providerMode === 'simulation'
                      ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 shadow-xs'
                      : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
                  }`}
                >
                  <p className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                    <CheckCircle2 className={`w-3.5 h-3.5 ${providerMode === 'simulation' ? 'text-blue-600' : 'text-gray-400'}`} />
                    Simulation Mode (Recommended for testing)
                  </p>
                  <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                    Zero real emails dispatched. Simulates parallel batches, seed checks, bounces, and failover reallocation safely.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setProviderMode('live');
                    setStartError(null);
                  }}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    providerMode === 'live'
                      ? 'border-red-500 bg-red-50/50 dark:bg-red-950/20 shadow-xs'
                      : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
                  }`}
                >
                  <p className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                    <AlertCircle className={`w-3.5 h-3.5 ${providerMode === 'live' ? 'text-red-600' : 'text-gray-400'}`} />
                    Live Google Workspace Mode
                  </p>
                  <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                    Sends real cold outreach via Google Workspace service account (domain-wide delegation) or Nodemailer SMTP fallback. Requires credentials.
                  </p>
                </button>
              </div>

              {providerMode === 'live' && (
                <div className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>Live Mode Safety Requirements:</strong> Valid physical business address, sender name, and opt-out link are legally enforced. Google Service Account credentials must be configured in <code>.env.local</code>.
                  </span>
                </div>
              )}
            </div>

            {/* Pre-Flight Test Send Box */}
            <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  Pre-Flight Test Send
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Send a single test email with current message personalization and CAN-SPAM footer to your own address before launching.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Input
                  type="email"
                  placeholder="Enter your personal or test address (e.g. founder@domain.com)"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  className="text-xs bg-white dark:bg-gray-900 h-9"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTestSend}
                  disabled={isTesting || !testEmail}
                  className="shrink-0 h-9 text-xs"
                >
                  <Mail className="w-3.5 h-3.5 mr-1.5" />
                  {isTesting ? 'Sending Test...' : 'Send Test Email'}
                </Button>
              </div>

              {testResult && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                    testResult.success
                      ? 'bg-green-50/80 dark:bg-green-950/30 border-green-200 dark:border-green-900 text-green-800 dark:text-green-300'
                      : 'bg-red-50/80 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-green-600 dark:text-green-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                  )}
                  <div className="space-y-0.5">
                    <p className="font-semibold">
                      {testResult.success ? 'Test Send Successful!' : 'Test Send Failed'}
                    </p>
                    {testResult.messageId && (
                      <p className="text-[11px] font-mono">
                        Message-ID: {testResult.messageId} ({testResult.mode} mode)
                      </p>
                    )}
                    {testResult.notice && <p className="text-[11px]">{testResult.notice}</p>}
                    {testResult.error && <p className="text-[11px]">{testResult.error}</p>}
                  </div>
                </div>
              )}
            </div>

            {startError && (
              <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-800 dark:text-red-300 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                <div className="space-y-1">
                  <p className="font-bold">Campaign Launch Blocked</p>
                  <p className="leading-relaxed">{startError}</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/60 space-y-1">
                <p className="text-xs text-gray-400">Target Recipients</p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {validRecipients.length} valid contacts
                </p>
                <p className="text-xs text-gray-500">De-duplicated &amp; suppression verified</p>
              </div>

              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/60 space-y-1">
                <p className="text-xs text-gray-400">Pacing &amp; ETA</p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {daysNeeded === 1 ? '1 Day (Today)' : `${daysNeeded} Days`}
                </p>
                <p className="text-xs text-gray-500">Window: {windowStart}&ndash;{windowEnd}</p>
              </div>

              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/60 space-y-1">
                <p className="text-xs text-gray-400">Subject</p>
                <p className="font-semibold text-gray-900 dark:text-white truncate">
                  {subject}
                </p>
                <p className="text-xs text-gray-500">Personalized with {"{{name}}"}</p>
              </div>

              <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/60 space-y-1">
                <p className="text-xs text-gray-400">Fleet Capacity</p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {activeMailboxes.length} mailboxes &bull; {totalFleetDailyCap}/day cap
                </p>
                <p className="text-xs text-gray-500">Failover reallocation active</p>
              </div>
            </div>

            {/* Auto Rules Highlights */}
            <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Active Automated Safety Guardrails
              </p>
              <ul className="text-xs text-gray-600 dark:text-gray-300 space-y-1.5 list-disc pl-4">
                <li>Seed spam placement 2 of last 3 &rarr; Auto-pause mailbox, flag domain on watch.</li>
                <li>Bounce rate &gt;3% (once at least 50 sent) &rarr; Auto-pause mailbox.</li>
                <li>2 or more mailboxes flagged on one domain &rarr; Auto-pause entire domain.</li>
                <li>Upon pause &rarr; Move unsent emails to healthy mailboxes; never resend to sent contacts.</li>
                <li>Late bounces &amp; delayed signals monitored constantly (absence of signal is not proof of safety).</li>
              </ul>
            </div>

            {/* Mandatory Compliance Checkbox */}
            <div className="p-5 rounded-2xl bg-gray-50 dark:bg-gray-800/60 border-2 border-gray-200 dark:border-gray-700 flex items-start gap-3">
              <Checkbox
                id="consentCheck"
                checked={consent}
                onCheckedChange={(checked) => setConsent(Boolean(checked))}
                className="mt-1"
              />
              <div className="space-y-1">
                <Label htmlFor="consentCheck" className="font-medium text-gray-900 dark:text-white cursor-pointer">
                  Consent &amp; CAN-SPAM Compliance Agreement
                </Label>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  &ldquo;This list is relevant to my business and I will honour opt-outs&rdquo;. I acknowledge that every outbound message contains valid physical street address details, an opt-out mechanism, and that unsubscribes/bounces are automatically suppressed from future sends.
                </p>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(3)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button
                onClick={handleStartCampaign}
                disabled={!consent}
                className="min-w-[160px]"
              >
                <Send className="w-4 h-4 mr-2" /> Start Campaign
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
