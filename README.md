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

Firestore persistence is conditional on configuration, and recipient persistence currently saves only the first 100 recipients per call. The worker processes batches when called by the browser; there is no independent background scheduler. Its kill switch is held in server memory, and leases are applied to request-supplied state rather than acquired with a shared database transaction. Campaign state also includes a JavaScript `Set` that needs explicit serialization across the worker API. These areas need further work before relying on live campaign execution.

Keep credentials in `.env.local`, which is excluded from Git along with dependencies and generated build output. The example environment file is included so a new checkout can be configured.
