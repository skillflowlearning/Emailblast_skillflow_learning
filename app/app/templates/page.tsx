'use client';
import { useState } from 'react';
import { Wand2, Copy, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import Stepper from '@/components/layout/Stepper';
import { generateTemplates, type EmailTemplate } from '@/lib/services/templateWriter';

const steps = [{ label: 'Details' }, { label: 'Generate' }, { label: 'Templates' }];

export default function TemplatesPage() {
  const [step, setStep] = useState(0);
  const [business, setBusiness] = useState('');
  const [offer, setOffer] = useState('');
  const [audience, setAudience] = useState('');
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const generate = async () => {
    setStep(1);
    setLoading(true);
    const res = await generateTemplates({ business, offer, audience });
    setLoading(false);
    setTemplates(res);
    setStep(2);
  };

  const copyTemplate = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
          AI Template Writer
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          Generate 3 ready-to-use email variations for your campaign.
        </p>
      </div>
      <Stepper steps={steps} currentStep={step} />

      {(step === 0 || (step === 1 && loading)) && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label>Your Business / Product Name</Label>
              <Input
                placeholder="e.g. Acme SaaS"
                value={business}
                onChange={(e) => setBusiness(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label>What are you offering?</Label>
              <Input
                placeholder="e.g. 30-day free trial of our analytics platform"
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label>Target Audience</Label>
              <Input
                placeholder="e.g. small business owners"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button
              className="w-full"
              onClick={generate}
              disabled={!business.trim() || !offer.trim() || !audience.trim() || loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Templates...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4 mr-2" /> Generate 3 Templates
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && templates.length > 0 && (
        <div className="space-y-4">
          {templates.map((template) => (
            <Card key={template.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{template.tone} Tone</CardTitle>
                  <Badge variant="secondary">{template.tone}</Badge>
                </div>
                <CardDescription className="font-medium text-gray-700 dark:text-gray-300">
                  Subject: {template.subject}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-sans bg-gray-50 dark:bg-gray-800 rounded-xl p-4 max-h-48 overflow-y-auto">
                  {template.body}
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() =>
                    copyTemplate(template.id, `Subject: ${template.subject}\n\n${template.body}`)
                  }
                >
                  {copied === template.id ? (
                    <>
                      <Check className="w-3 h-3 mr-2 text-green-500" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 mr-2" /> Copy Template
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setStep(0);
              setTemplates([]);
              setBusiness('');
              setOffer('');
              setAudience('');
            }}
          >
            Generate New Templates
          </Button>
        </div>
      )}
    </div>
  );
}
