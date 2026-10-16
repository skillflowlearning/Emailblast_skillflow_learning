import { NextRequest, NextResponse } from 'next/server';
import { BlastEngine, blastEngine, EngineState } from '@/lib/services/blastEngine';
import { GmailMailProvider, GmailBounceSource, GmailSeedChecker } from '@/lib/services/gmailProvider';
import { blastStorage } from '@/lib/services/blastStorage';
import { BLAST_CONFIG, canRunLiveSending } from '@/lib/config/blastConfig';

// In-memory global kill switch state on the server
let isGlobalKillSwitchActive = false;
const inFlightCampaigns = new Set<string>();
const revisions = new Map<string, number>();

export async function GET() {
  return NextResponse.json({
    killSwitchActive: isGlobalKillSwitchActive,
    providerMode: BLAST_CONFIG.PROVIDER_MODE,
    canRunLive: canRunLiveSending(),
    seedEmails: BLAST_CONFIG.LIVE_SEEDS,
  });
}

/**
 * Server-Side Worker API Route
 * Executes one due operation per request. Locks and revisions here are
 * process-local; deployment still needs a durable queue and shared leases.
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
        seedEmails: BLAST_CONFIG.LIVE_SEEDS,
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
      if (!state.campaign?.id || !Array.isArray(state.recipients) || !Array.isArray(state.mailboxes)
        || !Array.isArray(state.domains) || !Array.isArray(state.delayedSignalMailboxes)
        || state.recipients.length > BLAST_CONFIG.MAX_RECIPIENTS) {
        return NextResponse.json({ error: 'Invalid campaign state.' }, { status: 400 });
      }
      const expectedRevision = revisions.get(state.campaign.id) || 0;
      if (inFlightCampaigns.has(state.campaign.id) || (state.revision || 0) !== expectedRevision) {
        return NextResponse.json({ error: 'Campaign state is stale or another operation is in progress. Sending stopped; reload the current state.' }, { status: 409 });
      }
      const live = BLAST_CONFIG.PROVIDER_MODE === 'live';
      if ((state.campaign.providerMode === 'live') !== live) {
        return NextResponse.json({ error: 'Campaign mode does not match the server provider mode.' }, { status: 400 });
      }
      if (live && (!canRunLiveSending() || !BLAST_CONFIG.LIVE_SEEDS.length)) {
        return NextResponse.json({ error: 'Live sending requires credentials and configured BLAST_SEED_EMAILS.' }, { status: 400 });
      }
      state.simulationMode = !live;
      inFlightCampaigns.add(state.campaign.id);

      // Select appropriate engine based on mode
      const activeEngine =
        BLAST_CONFIG.PROVIDER_MODE === 'live'
          ? new BlastEngine(
              new GmailMailProvider(),
              new GmailBounceSource(),
              new GmailSeedChecker()
            )
          : blastEngine;

      try {
        const result = await activeEngine.processMailboxBatch(mailboxId, state);
        result.updatedState.revision = expectedRevision + 1;
        revisions.set(state.campaign.id, result.updatedState.revision);

        await blastStorage.saveCampaign(result.updatedState.campaign);

        return NextResponse.json({
          success: true,
          sentThisBatch: result.sentThisBatch,
          bouncedThisBatch: result.bouncedThisBatch,
          updatedState: result.updatedState,
        });
      } finally {
        inFlightCampaigns.delete(state.campaign.id);
      }
    }

    return NextResponse.json({ error: 'Invalid worker action or parameters' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Worker error' }, { status: 500 });
  }
}
