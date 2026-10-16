# MailFlow / Emailblast Skillflow Learning

A Next.js application for email list cleaning, spam-risk checks, message templates, and email campaign workflows.

## Run locally

Install Node.js and npm, then run:

```sh
npm ci
```

Copy `env.local.example` to `.env.local`. Keep `BLAST_PROVIDER_MODE=simulation` for development. The example Firebase values are placeholders; configure your own Firebase project for persistence.

```sh
npm run dev
```

Open http://localhost:3000. The home page redirects to `/services`.

Development output is stored in `.next-dev`; production builds use `.next`. This keeps `npm run build` from overwriting files used by a running development server. Restart `npm run dev` after changing the Next.js configuration.

```sh
npm run build
npm start
```

## Features and routes

| Route | Purpose |
| --- | --- |
| `/services` | Service selection |
| `/app/clean` | Email list upload, syntax checks, disposable-domain and role-account flags |
| `/app/spam-check` | Rule-based subject and body analysis |
| `/app/templates` | Professional, friendly, and direct message templates |
| `/app/blast` | Five-step campaign setup and campaign monitoring |
| `/campaigns` | Campaign management interface |
| `/domains` | Domain management interface |
| `/reports` | Reporting interface |
| `/settings` | Settings and emergency sending controls |
| `/admin` | Administration interface |
| `/unsubscribe` | Recipient unsubscribe interface |

The campaign engine includes mailbox capacity checks, recipient allocation, simulated bounce and seed signals, pause rules, and reassignment of pending recipients. Server routes provide batch processing (`/api/blast/worker`), test sends (`/api/blast/test-send`), and unsubscribe requests (`/api/unsubscribe`). Live provider code uses the Gmail API with an SMTP fallback through Nodemailer.

## Project structure

- `app/`: App Router pages, layouts, and API routes.
- `components/`: Campaign monitoring, navigation, and shared interface components.
- `lib/config/`: Sending limits, provider mode, and demo mailbox configuration.
- `lib/services/`: Campaign engine, mail providers, Firestore access, and email utilities.
- `lib/types/`: Campaign, recipient, mailbox, domain, and provider types.
- `public/` and `photos/`: Image assets.
- `SETUP.md`: Google Workspace credentials and sending setup guide.

Built with Next.js 15, React 19, TypeScript, Tailwind CSS, Radix UI, Firebase, Papa Parse, and Nodemailer.

## Current implementation notes

This is a development and learning application. Email cleaning uses local rules rather than mailbox verification; spam scoring uses heuristics; template generation uses predefined copy. Several dashboard pages start with empty data and are not fully connected to persistent campaign records.

The sending engine now uses per-mailbox deadlines: one due operation per tick, 30–120 second gaps, 10–15 message batches, and a two-minute signal wait. Simulation uses a 60× clock and never sends real mail. Seed messages count toward mailbox capacity. Spam/bounce rules activate eligible spares, block paused domains, and leave overflow queued. Failed signal checks never count as successful inbox placement. A 48-hour cooldown blocks early mailbox recovery; explicit recovery starts at 8/day. Healthy daily rollover applies the configured ramp up to 50/day.

Firestore persistence is conditional on configuration, and recipient persistence currently saves only the first 100 recipients per call. The worker runs when called by the browser; there is no independent background scheduler. Its kill switch, concurrency lock, and stale-request revisions are process-local. They do not provide durable or cross-instance idempotency. Campaigns and mailbox quotas must move to authenticated, authoritative server storage with transactional leases before a live deployment. Local suppression fallback is in memory and does not survive restarts. Outlook/Yahoo seed access is not implemented. Soft bounces are recorded for review rather than automatically re-sending an email already accepted by the provider.

For live seed checks, set `BLAST_SEED_EMAILS` to inboxes you own and can read using your Workspace delegation. Demo seed addresses are simulation-only. Personal Gmail, Outlook, and Yahoo inboxes need their own authorization integrations.

Run `npm test` for the engine and mocked Gmail-provider checks. See `PROJECT_STATUS.md` for completed work and the remaining launch steps.

Keep credentials in `.env.local`, which is excluded from Git along with dependencies and generated build output. The example environment file is included so a new checkout can be configured.
