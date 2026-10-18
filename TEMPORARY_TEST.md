# Temporary owned-address SMTP test

Page: `/app/blast/test`. This feature is isolated in that page, `/api/temporary-test`, `lib/temporary-test` and its test file. Remove those files and the temporary navigation item when finished. It does not use or modify the simulation engine, automatic rules or settings.

Add these **server-only** variables in Vercel and redeploy:

```env
TEST_MODE_ENABLED=true
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
TEST_FROM_NAME=
TEST_FROM_EMAIL=
```

Use your provider's actual SMTP settings. Port 465 commonly uses `SMTP_SECURE=true`; STARTTLS on 587 uses `false`. `TEST_FROM_EMAIL` defaults to `SMTP_USER` and must be an authorized sending identity. Never prefix these variables with `NEXT_PUBLIC_`. Sender configuration and credentials are never returned to the browser. No SMTP debug logging is enabled.

Existing Firebase authentication/Firestore, stable `BLAST_APP_SECRET`, and canonical `NEXT_PUBLIC_APP_URL` must already be configured on Vercel; they enforce account suppression/emergency stop and signed unsubscribe links. This page does not need Google mailbox OAuth or the campaign scheduler. Local development can use the existing localhost session/disk store.

Set the Vercel function duration to support 120 seconds. Ten sequential sends plus 3–8 second gaps can exceed a short function timeout. The handler stops starting new sends after its 90-second processing budget; SMTP timeouts are bounded. A platform timeout can still leave an uncertain result. Never automatically retry that batch.

Enter only owned addresses, subject/body and your real physical business address. `{{name}}` uses the recipient address prefix. Preview shows placeholders for the server-only sender and signed link; actual mail includes those values and List-Unsubscribe headers.

Dry run is on by default and sends nothing. It respects suppression/kill switch and exercises the same delays with a separate test quota. The yellow banner remains visible.

Browser localStorage tracks date/sender quota in Asia/Kolkata; a server-side transactional sender ledger also enforces 50/day across tabs/accounts. Failed/uncertain attempts conservatively consume capacity. Requests contain at most 10 unique recipients. Pending overflow is saved locally with a downloadable CSV; load it manually tomorrow. No automatic retries or page-reload sending occurs.

Pause freezes the inter-batch countdown; Stop prevents subsequent requests. An already-submitted server batch may finish. Browser Web Locks prevents concurrent runs for a sender in compatible browsers; the server also serializes batches. Clearing browser data does not reset the server cap. Use the existing emergency kill switch to block further sends inside a running batch.

Turn `TEST_MODE_ENABLED=false` and redeploy when finished.
