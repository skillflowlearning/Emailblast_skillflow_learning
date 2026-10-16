# Email Blast progress — SkillFlow Learning

## Scope

Email Blast is the current priority. List cleaning, standalone spam scoring, and AI template integrations are deferred.

## Available in local simulation

- Five-step wizard, CSV/text recipients, demo fleet of 9 active mailboxes and 1 spare, campaign dashboard, and event log.
- A second spam placement within the last three seed results pauses a mailbox for 48 hours and puts its domain on watch. Promotions is not spam.
- Two health-flagged mailboxes pause the domain and block every mailbox on it.
- Bounce rate strictly over 3% after at least 50 sends pauses the mailbox.
- Eligible spares activate automatically. Only pending, never-sent recipients move; sent and in-flight records are preserved. Transfers reserve available capacity and overflow stays queued.
- No healthy capacity produces an alert and stops the campaign.
- Sending deadlines enforce random 30–120 second gaps, 10–15 messages per batch, and a two-minute wait before signal evaluation. Simulation accelerates these delays 60×. Live sends use the configured timezone (default Asia/Kolkata) and 10am–6pm window.
- Daily rollover resets usage, applies a healthy-day ramp, and enforces the 50/day hard cap. Cooldown recovery requires explicit action and starts at 8/day.
- Every 11th outgoing message is a seed probe and uses mailbox capacity. Probes have unique tokens; Gmail checks include spam folders and match the sender and token.
- Failed seed/bounce/reply/suppression checks stop or defer sending rather than pretending the mailbox is healthy.
- Footer, reply address, and provider message IDs are passed through the engine. Replies opt recipients out of future pending sends.
- Browser/worker state is JSON-safe. The worker rejects overlapping or stale requests within its process. Ambiguous dispatch failures are held for review instead of retried through SMTP.

## Verification

- `npm test`: 28 engine/provider checks, with a fake clock and mocked mail/network providers. No real email is sent by these tests.
- Browser simulation: first spam result left the sender active; second paused it, marked the domain watch, activated the spare, and transferred 9 pending recipients while preserving the already-sent recipient.
- These checks do not prove real Gmail delivery or production reliability.

## Remaining before a live launch

1. Move campaigns, all recipients, mailbox quotas, suppression, kill switch, and worker ownership to authenticated server storage. Remove the 100-recipient persistence limit.
2. Implement shared transactional leases, a durable queue, reconciliation for uncertain sends, and recovery after process restarts. Current locks/revisions and local fallback storage are in memory only.
3. Add a scheduler/worker service that continues without a browser tab, plus campaign reload/resume from saved state.
4. Connect the actual Workspace sending and seed accounts. Exercise real bounce/reply fixtures, pagination, notification deduplication, and message correlation end to end.
5. Finish unsubscribe persistence/token verification and test it against the deployed public URL.
6. Set up domains, DNS authentication, redirection, warm-up, hosting, and monitoring; verify live behavior using only the owner's test address before any recipient campaign.
7. Add personal Gmail OAuth and Outlook/Yahoo seeds later. Verification and AI templates remain deferred.

## Decisions still needed

- Third sending domain and the spare's healthy-domain placement.
- Actual team mailbox names and owned seed inboxes.
- Business address, list source, and final hosting/scheduler environment.

Credentials belong in `.env.local` or the deployment secret store, never in this document or GitHub.
