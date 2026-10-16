# MailFlow / Emailblast Skillflow Learning

Email Blast is the current focus: saved campaigns, paced Google Workspace sending, health checks and automatic reassignment of pending recipients. Cleaning, standalone spam scoring and AI templates remain prototypes.

## Local simulation

Requires Node.js 22 and npm. Copy `env.local.example` to `.env.local`; keep `BLAST_PROVIDER_MODE=simulation` and `BLAST_STORAGE=local`.

```sh
npm ci
npm run dev
```

In a second terminal in the same project folder:

```sh
npm run worker
```

Open [Email Blast](http://localhost:3000/app/blast). Campaigns save every imported recipient (up to 10,000 per campaign) in the ignored `.mailflow-local` folder. Reopen from [Campaigns](http://localhost:3000/campaigns). The worker continues with the browser closed; the computer and worker process must remain running. Use the same browser profile for your local session. Back up local data and its secret together. Local demo data does not automatically migrate to a cloud workspace.

Development uses `.next-dev`; production uses `.next`. This prevents builds from replacing a running dev server's generated chunks. If a missing generated module error persists, stop this project's servers, clear only its generated `.next-dev`/`.next` folders, and restart.

## Google and hosting setup

- [GOOGLE_SETUP.md](GOOGLE_SETUP.md): domains, mailboxes, Firebase, OAuth and mandatory health checks.
- [DEPLOYMENT.md](DEPLOYMENT.md): Firestore, Cloud Run, authenticated Cloud Tasks and Scheduler recovery.
- [PROJECT_STATUS.md](PROJECT_STATUS.md): implementation and remaining launch work.

Saved campaigns use each user's connected Google OAuth accounts. The legacy delegation/SMTP helper remains for compatibility; saved campaigns never use its fallback. No real credentials or cloud resources are included.

## Sending behavior

- Mailbox daily cap 30, optional healthy-day ramp defaults to 15%, hard maximum 50. Seeds and health probes consume capacity.
- Random 30–120 second gaps, batches of 10–15, then two minutes to check signals. Default 10am–6pm Asia/Kolkata. Simulation runs 60× faster.
- Two spam placements among the latest three seed results pause the mailbox for 48h and put its domain on watch. Promotions is not spam.
- Two distinct flagged mailboxes pause their domain for 72h. Only pending recipients transfer to healthy senders/spares; sent or uncertain deliveries never transfer.
- Bounce rate above 3% after at least 50 sends pauses the mailbox. Failed signal checks cannot count as healthy.
- Recovery requires a fresh passing probe after cooldown, explicit activation and starts at 8/day.
- Protected live launch requires two different registered sending domains, healthy connected senders, a separate owned seed inbox and a healthy spare. Six mailboxes or subdomains under one registered domain cannot satisfy the two-domain requirement. A domain's mailboxes share its sending budget.
- Replies and signed unsubscribe requests persist to the owner's suppression list. Emergency stop persists across restarts.

## Server design and limits

`lib/server` owns authentication, campaign state, encrypted refresh tokens, leases, delivery attempts and scheduling. Local development uses atomic filesystem transactions; production requires Firestore transactions. Workspaces are isolated by authenticated Firebase owner. Browsers display progress and submit controls; a separate worker drives sending.

An attempt is saved before contacting Gmail. Uncertain outcomes are held to avoid automatic duplicates. Domains offers a Gmail Sent check using a saved RFC Message-ID. Only a positive match confirms acceptance; a missing result remains held for investigation. Exactly-once delivery and inbox placement are not guaranteed.

Production jobs require Google-signed OIDC tokens for the configured service account. Tasks schedules the next operation; Scheduler recovers due work. Currently one unfinished live campaign is allowed per workspace, with an 8 MiB serialized storage limit. Archive/export UI and large-scale storage optimization remain pending.

## Validation

```sh
npm test
npx tsc --noEmit
npm run build
```

Tests use simulation and mocked Google responses; they never send email. Google OAuth, cloud transactions and deployed scheduling require real-project integration testing. See security notes in `PROJECT_STATUS.md` before public deployment.

Keep credentials in `.env.local` or the hosting secret store. Never commit passwords, keys, refresh tokens or local workspace data.
