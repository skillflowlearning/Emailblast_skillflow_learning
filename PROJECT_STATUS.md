# Email Blast status — 16 October 2026

## Implemented

- Saved campaigns and all recipients (maximum 10,000 per import), reloadable from Campaigns.
- Separate local worker; browser closure does not drive or stop sending.
- Production Firestore transaction adapter, shared leases, delivery-attempt ledger and durable kill/suppression state.
- Cloud Tasks next-operation scheduling and authenticated Scheduler recovery endpoint.
- Firebase owner sessions; localhost-only local sessions; workspace isolation.
- Google OAuth sender/seed connections with PKCE/state validation and encrypted refresh tokens. Personal Gmail seeds supported through OAuth.
- Domain ownership TXT and MX/SPF/DKIM/DMARC checks, independent registered-domain launch requirement, shared domain budget and mandatory spare/seed checks.
- Real owned-seed health jobs, two-minute wait, exact matching probe/folder check and explicit activation.
- Mailbox 48h / domain 72h cooldown, fresh post-cooldown test, recovery at 8/day. Pending-only failover.
- Signed owner-scoped unsubscribe tokens and persistent reply/unsubscribe suppression.
- Crash/network uncertainty holds; positive Gmail Sent reconciliation without automatic resend.
- Next.js updated to 15.5.28; separate dev/build output directories retained.

## Verified locally

- 52 automated tests: engine timing/rules, mocked Gmail/pagination, persistence of 10,000 records and Unicode chunks, cross-worker exclusion, pause during dispatch, uncertainty holds/recovery, health wait, shared registered-domain quota, account isolation, OAuth state/PKCE and unauthorized endpoint rejection.
- Browser simulation closed at 37/90; worker advanced independently, resumed after a worker restart, and reopening showed completed 90/90.
- No real mail sent by the simulation or automated tests.

## Required before real launch

1. Purchase domains, create/licence Workspace users and owned seed accounts, configure DNS/signing.
2. Create Firebase/Google project, web OAuth client and hosting secrets.
3. Deploy Firestore rules, Cloud Run, Tasks queue/IAM and Scheduler; test concurrent cloud transactions and recovery in that real project.
4. Complete real OAuth/refresh/revoke, inbox/spam/bounce/reply and public unsubscribe integration checks with owned test accounts.
5. Prepare public-app privacy/consent disclosures and applicable Google verification/security assessment.
6. Review remaining dependency audit findings before public launch. Compatible fixes were applied, but the current audit still reports transitive PostCSS, Firebase gRPC and build-tool dependency advisories; a clean audit is not claimed. Do not blindly run the breaking `npm audit fix --force` downgrade/migration recommendations.

## Current limits / deferred

- One unfinished live campaign per workspace; 8 MiB serialized workspace limit. No archive/export or automatic local-to-cloud migration UI.
- Sent-folder search cannot prove a missing message was never sent. Unresolved holds require operator investigation.
- Firestore currently stores chunked workspace snapshots; cost/performance at scale needs measurement.
- Outlook/Yahoo seed providers, paid verification and AI integrations remain pending.
- Legacy reports/admin/cleaning screens are prototypes; campaign counters come from the saved campaign.
- No domains, Google credentials, Firebase project, scheduler or production deployment were configured during this implementation.

See [GOOGLE_SETUP.md](GOOGLE_SETUP.md) and [DEPLOYMENT.md](DEPLOYMENT.md). Private credentials never belong in GitHub or chat.
