import { NextRequest, NextResponse } from 'next/server';
import { BLAST_CONFIG, canRunLiveSending } from '@/lib/config/blastConfig';
import { GmailMailProvider } from '@/lib/services/gmailProvider';
import { defaultMockMailProvider } from '@/lib/services/blastProviders';
import { blastStorage } from '@/lib/services/blastStorage';

/**
 * Test Send API Route
 * Sends a single test email to the owner's own address before launching a campaign.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      toEmail,
      fromEmail,
      fromName,
      subject,
      content,
      senderName,
      businessAddress,
      optOutLine,
    } = body;

    if (!toEmail || !toEmail.includes('@')) {
      return NextResponse.json({ error: 'Valid test recipient email is required.' }, { status: 400 });
    }

    const fullBody = `${content || 'This is a test message from MailFlow Email Blast.'}\n\n---\nSent by ${senderName || 'Your Business'} • ${businessAddress || '100 Main St, City, ST'} • ${optOutLine || "Reply 'STOP' to unsubscribe"}`;

    const isLive = BLAST_CONFIG.PROVIDER_MODE === 'live';

    if (isLive) {
      if (!canRunLiveSending()) {
        return NextResponse.json(
          {
            error:
              'Cannot execute live test send: Missing Google Workspace Service Account or SMTP credentials in .env.local.',
          },
          { status: 500 }
        );
      }

      const provider = new GmailMailProvider();
      const result = await provider.sendEmail({
        fromEmail: fromEmail || 'outreach@domain.com',
        fromName: fromName || senderName || 'MailFlow Test',
        toEmail,
        subject: `[TEST] ${subject || 'Cold Outreach Preview'}`,
        body: fullBody,
        campaignId: 'test-send',
        recipientId: 'test-owner',
      });

      await blastStorage.logEvent({
        id: `test-evt-${Date.now()}`,
        campaignId: 'test-send',
        timestamp: Date.now(),
        level: 'success',
        title: 'Live Test Send Successful',
        description: `Delivered test email to ${toEmail} via ${fromEmail || 'primary mailbox'}. Message ID: ${result.messageId}`,
      });

      return NextResponse.json({
        success: true,
        mode: 'live',
        messageId: result.messageId,
        recipient: toEmail,
        timestamp: Date.now(),
      });
    }

    // Simulation Mode
    const mockResult = await defaultMockMailProvider.sendEmail({
      fromEmail: fromEmail || 'alex@mail.acme-sales.com',
      fromName: fromName || senderName || 'MailFlow Simulation',
      toEmail,
      subject: `[SIMULATION TEST] ${subject || 'Outreach Test'}`,
      body: fullBody,
      campaignId: 'test-send',
      recipientId: 'test-owner',
    });

    return NextResponse.json({
      success: true,
      mode: 'simulation',
      messageId: mockResult.messageId,
      recipient: toEmail,
      timestamp: Date.now(),
      notice: 'Simulation mode: mock transport executed (no real email dispatched).',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Test send failed' }, { status: 500 });
  }
}
