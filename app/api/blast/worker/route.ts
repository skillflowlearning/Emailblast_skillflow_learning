import { NextRequest, NextResponse } from 'next/server';
import { BlastEngine, blastEngine, EngineState } from '@/lib/services/blastEngine';
import { GmailMailProvider, GmailBounceSource, GmailSeedChecker } from '@/lib/services/gmailProvider';
import { blastStorage } from '@/lib/services/blastStorage';
import { BLAST_CONFIG, canRunLiveSending } from '@/lib/config/blastConfig';

// In-memory global kill switch state on the server
let isGlobalKillSwitchActive = false;

export async function GET() {
  return NextResponse.json({
    killSwitchActive: isGlobalKillSwitchActive,
    providerMode: BLAST_CONFIG.PROVIDER_MODE,
    canRunLive: canRunLiveSending(),
  });
}

/**
 * Server-Side Worker API Route
 * Processes sending batches on the server, enforcing lease locks,
 * idempotency, and the global emergency kill switch.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, mailboxId, engineState } = body;

    if (action === 'status') {
      return NextResponse.json({
        killSwitchActive: isGlobalKillSwitchActive,
        providerMode: BLAST_CONFIG.PROVIDER_MODE,
        canRunLive: canRunLiveSending(),
      });
    }

    if (action === 'unkill') {
      isGlobalKillSwitchActive = false;
      return NextResponse.json({ success: true, message: 'Global Kill Switch disengaged.' });
    }

    if (action === 'kill') {
      isGlobalKillSwitchActive = true;
      return NextResponse.json({ success: true, message: 'Global Kill Switch engaged.' });
    }

    // Check emergency kill switch for sending operations
    if (isGlobalKillSwitchActive) {
      return NextResponse.json(
        {
          error: 'Global Kill Switch is ACTIVE. All server-side sending is halted immediately.',
          killed: true,
        },
        { status: 403 }
      );
    }

    if (action === 'tick' && engineState && mailboxId) {
      const state = engineState as EngineState;

      // Enforce lease lock on pending recipients before dispatching batch
      const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const now = Date.now();

      // Acquire lease on pending recipients for this mailbox to prevent concurrent double-sends
      const lockedRecipients = state.recipients.map((r) => {
        if (
          r.mailboxId === mailboxId &&
          r.status === 'pending' &&
          (!r.leaseExpiresAt || r.leaseExpiresAt < now)
        ) {
          return {
            ...r,
            status: 'sending' as const,
            leaseExpiresAt: now + BLAST_CONFIG.LEASE_TIMEOUT_MS,
            leaseWorkerId: workerId,
          };
        }
        return r;
      });

      // Pass state to blast engine
      const intermediateState: EngineState = {
        ...state,
        recipients: lockedRecipients.map((r) =>
          r.status === 'sending' ? { ...r, status: 'pending' as const } : r
        ),
      };

      // Select appropriate engine based on mode
      const activeEngine =
        BLAST_CONFIG.PROVIDER_MODE === 'live'
          ? new BlastEngine(
              new GmailMailProvider(),
              new GmailBounceSource(),
              new GmailSeedChecker()
            )
          : blastEngine;

      const result = await activeEngine.processMailboxBatch(mailboxId, intermediateState);

      // Persist state to Firestore/Storage
      await blastStorage.saveCampaign(result.updatedState.campaign);

      return NextResponse.json({
        success: true,
        sentThisBatch: result.sentThisBatch,
        bouncedThisBatch: result.bouncedThisBatch,
        updatedState: result.updatedState,
      });
    }

    return NextResponse.json({ error: 'Invalid worker action or parameters' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Worker error' }, { status: 500 });
  }
}
