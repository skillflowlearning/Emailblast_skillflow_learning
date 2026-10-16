# Setup

Start with [GOOGLE_SETUP.md](GOOGLE_SETUP.md), then [DEPLOYMENT.md](DEPLOYMENT.md).

The current app connects each sending mailbox through Google OAuth on Domains. Domain-wide delegation keys and SMTP credentials are not required for saved campaigns. Earlier legacy-provider instructions do not apply.

For local simulation without Google/Firebase accounts:

1. Copy `env.local.example` to `.env.local`.
2. Run `npm ci` and `npm run dev`.
3. Keep a second terminal running `npm run worker`.
4. Open `http://localhost:3000/app/blast`, create a simulation and reopen it from Campaigns.

Browser closure does not stop the separate worker. Turning off the computer does. Use hosted Firestore, Tasks and Scheduler for independent cloud operation.
