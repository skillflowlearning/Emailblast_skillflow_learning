# Google Workspace Email Blast Setup Guide

This guide explains how to configure Google Workspace for the **Email Blast** system (`/app/blast`).

---

## 1. Overview & Architecture

- **Cold Email Provider:** Google Workspace mailboxes only via the **Gmail API** (with SMTP via **Nodemailer** as fallback).
- **Bounce Handling:** Bounces are **not** received via webhooks; the system directly inspects each sending mailbox's own inbox for Delivery Status Notifications (DSNs from `mailer-daemon` or `postmaster`).
- **Seed Checker:** Probes seed inboxes via the Gmail API to classify messages into `INBOX`, `CATEGORY_PROMOTIONS`, or `SPAM`. *(Note: Placement in Google Workspace Promotions tab is normal commercial deliverability and is **not** spam).*
- **Server Worker:** `/api/blast/worker` executes one due send or signal check per request. The browser currently drives these requests, so closing it stops execution. Locks and request revisions are process-local. A scheduler, authoritative server storage, authentication, and transactional leases are required before live deployment.
- **Provider Modes:**
  - `simulation` (Default): Fully simulated sandbox with test buttons to inject bounces, spam placements, and delayed signals. No credentials required, zero real emails sent.
  - `live`: Real sending from authorized Google Workspace mailboxes. Refuses to start if credentials or mandatory CAN-SPAM footers are missing.

---

## 2. Setting Up Google Cloud Service Account

### Step 1: Create a Google Cloud Project & Enable the Gmail API
1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `workspace-cold-blast`) or select an existing project.
3. In the sidebar, go to **APIs & Services** > **Library**.
4. Search for **Gmail API** and click **Enable**.

### Step 2: Create a Service Account
1. Go to **APIs & Services** > **Credentials**.
2. Click **Create Credentials** > **Service Account**.
3. Enter a service account name (e.g., `blast-mailer`) and click **Create and Continue**.
4. (Optional) Skip role assignment and click **Done**.
5. Click on the newly created service account, go to the **Details** tab, and copy its **Unique ID (Client ID)**. You will need this for domain-wide delegation.

### Step 3: Enable Domain-Wide Delegation
1. In the service account details view, navigate to the **Advanced Settings** section.
2. Under **Domain-wide delegation**, click **View Google Workspace Admin Console** or check **Enable Google Workspace Domain-wide Delegation**.

### Step 4: Generate a Private Key
1. In the service account details, click the **Keys** tab.
2. Click **Add Key** > **Create new key**.
3. Select **JSON** format and click **Create**.
4. A JSON key file will be downloaded. Open this file to find `client_email` and `private_key`.

---

## 3. Authorize Scopes in Google Workspace Admin Console

Domain-wide delegation allows the service account to impersonate each sending mailbox in your Google Workspace domain without individual OAuth prompts.

1. Sign in to the [Google Workspace Admin Console](https://admin.google.com) as a Super Administrator.
2. In the Admin console, navigate to:
   **Security** > **Access and data control** > **API controls** > **Manage Domain Wide Delegation**.
3. Click **Add new**.
4. In the **Client ID** field, paste the **Unique ID (Client ID)** of your Service Account copied from Step 2.
5. In the **OAuth scopes (comma-delimited)** field, enter the following exact scopes:
   ```text
   https://www.googleapis.com/auth/gmail.send, https://www.googleapis.com/auth/gmail.modify, https://www.googleapis.com/auth/gmail.readonly
   ```
6. Click **Authorize**.

---

## 4. Configure Environment Variables

Create or update your `.env.local` file:

```env
# Mode: 'simulation' (default) or 'live'
BLAST_PROVIDER_MODE=simulation
BLAST_SEED_EMAILS=

# Google Cloud Service Account Credentials
GOOGLE_SERVICE_ACCOUNT_EMAIL=blast-mailer@your-gcp-project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"

# Optional: SMTP Fallback Credentials (via Nodemailer)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
```

> **Security Note:** Never commit `.env.local` or service account private keys to source control. In production environments (e.g. Google Cloud Run, Vercel), store these variables in Google Secret Manager or your hosting provider's secure secret store.

For live seed monitoring, set `BLAST_SEED_EMAILS` to a comma-separated list of real inboxes you own and can access using domain-wide delegation. The demo seed addresses are never used by the live engine. Personal `@gmail.com` inboxes cannot be impersonated through Workspace domain-wide delegation; they require a separate OAuth connection. Outlook/Yahoo integrations remain pending.

---

## 5. Verification & Testing

### 1. Run in Simulation Mode (Default)
1. Start the application:
   ```bash
   npm run dev
   ```
2. Navigate to `http://localhost:3000/app/blast`.
3. In Step 5 ("Confirm & Start"), confirm that **Simulation Mode** is active.
4. Launch the campaign:
   - Test the simulation sandbox: click **Inject Fake Bounce**, **Inject Spam Placement**, and **Inject Delayed Signal**.
   - Verify that auto-pause triggers (bounce rate > 3%, seed spam 2 of 3) properly pause the mailbox and automatically reallocate unsent recipients to healthy mailboxes.
   - Test the **Emergency Global Kill Switch** to verify instant halting across the fleet.

### 2. Pre-Flight Test Send (Step 5)
1. Enter your personal/testing email address into the **Pre-Flight Test Send** box.
2. Click **Send Test Email**.
3. In simulation mode, this generates an RFC 2822 preview and confirms message formatting. In live mode, this delivers a real test message to your inbox.

### 3. Switch to Live Mode
1. Change `BLAST_PROVIDER_MODE=live` in `.env.local` and restart your server.
2. In Step 5, the engine verifies that:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` are present.
   - `BLAST_SEED_EMAILS` contains configured seed inboxes.
   - Mandatory CAN-SPAM details (sender name, postal address, opt-out line) are provided.
   - If credentials are missing, the system refuses to start and displays an actionable error banner.

---

## 6. Public Unsubscribe Endpoint

The system includes:
- **Web Interface:** `/unsubscribe?token=<token>&email=<email>`
- **API Endpoint:** `POST /api/unsubscribe` and `GET /api/unsubscribe?token=<token>&email=<email>`
- **RFC 8058 One-Click:** Outbound messages include `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers. Clicking the email client's native unsubscribe button triggers an automated post-back that adds the recipient to the Firestore suppression list immediately.
