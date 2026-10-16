# Hosted worker deployment

This is a deployment recipe, not a record of an existing deployment. Google/Firebase accounts, billing, IAM and OAuth approval are still required. Start with simulation and owned test inboxes.

## 1. Project resources

Use one Firebase/Google Cloud project. Enable Gmail API, Firestore, Firebase Authentication, Cloud Run, Cloud Build, Artifact Registry, Cloud Tasks, Cloud Scheduler and Secret Manager. Create the default Firestore Native database. Choose the database/hosting region before creating resources.

Deploy `firestore.rules` and `firestore.indexes.json` with the Firebase CLI against your project:

```sh
firebase deploy --only firestore --project YOUR_PROJECT_ID
```

Client access to campaign storage is denied; server Firebase Admin uses IAM. The app stores a transactionally consistent manifest and chunked JSON workspace. An 8 MiB workspace limit keeps writes below Firestore request limits. This design requires cost/load measurement before scaling.

## 2. Two service identities

Create a runtime identity such as `mailflow-app@PROJECT_ID.iam.gserviceaccount.com` and a job-invocation identity such as `mailflow-jobs@PROJECT_ID.iam.gserviceaccount.com`.

Grant the runtime identity:

- `roles/datastore.user` on the project for server data transactions.
- `roles/firebaseauth.admin` for Firebase session-cookie operations.
- `roles/cloudtasks.enqueuer` on the selected queue/project.
- `roles/iam.serviceAccountUser` on the job-invocation identity, so created tasks may attach that identity.
- `roles/secretmanager.secretAccessor` only on the app's required secrets.

The human deploying/creating jobs also needs permission to deploy Cloud Run and act as the selected identities. Keep Google's Cloud Tasks and Scheduler service agents and their managed service-agent roles enabled; they mint the invocation OIDC tokens. Do not grant broad project-owner permissions to the app.

## 3. Environment and secrets

Generate a cryptographically random `BLAST_APP_SECRET` of at least 32 characters, store it in Secret Manager, and back it up securely. Keep this exact value stable across deployments/instances: changing it makes saved OAuth tokens and unsubscribe links unreadable.

| Variable | Hosted value |
| --- | --- |
| `NODE_ENV` | `production` (container default) |
| `BLAST_STORAGE` | `firestore` |
| `BLAST_PROVIDER_MODE` | `simulation` until owned live tests are approved |
| `GOOGLE_CLOUD_PROJECT` | Your project ID |
| `NEXT_PUBLIC_APP_URL` | Canonical HTTPS app origin, no path |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase web app public API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase web auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Your project ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase web app ID |
| `GOOGLE_OAUTH_CLIENT_ID` | Web OAuth client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Secret Manager reference |
| `BLAST_APP_SECRET` | Stable Secret Manager reference |
| `BLAST_TASKS_QUEUE` | `projects/PROJECT_ID/locations/REGION/queues/mailflow` |
| `BLAST_WORKER_SERVICE_ACCOUNT` | Job-invocation identity email |

Cloud Run uses its runtime identity for Application Default Credentials. Do not upload a service-account JSON key there. For local Firestore integration use ADC or the optional Firebase Admin fields in the example environment. Local Firestore mode requires Firebase sign-in; the disk-backed demo is separate data.

Firebase web config is loaded at runtime from `/api/public-config`. Only public web fields are exposed. OAuth/client secrets and Admin credentials stay server-only. Add the hosted app hostname to Firebase Authentication authorized domains and the exact hosted `/api/google/callback` URI to your Google OAuth web client.

## 4. Cloud Run

The repository includes a Node.js 22 Dockerfile and `.dockerignore`. Use Cloud Run's source/Docker build, assign the runtime identity, configure the environment/secrets above, and set an HTTP request timeout of 240 seconds. A five-minute application lease prevents overlapping workspace operations. The handler sends/checks one due operation per invocation; it does not wait between messages inside a request.

Browser pages and recipient unsubscribe links require a publicly reachable HTTPS service. Cloud Run's public ingress is paired with application checks: Firebase sessions protect owner routes; `/api/jobs/blast` requires the configured Google-signed OIDC identity. Never expose development mode as the hosted service.

First deployment may be needed to obtain its service URL. Keep simulation enabled, then set `NEXT_PUBLIC_APP_URL`, Firebase authorized hostname, OAuth callback and queue configuration to that final URL before connecting accounts. A custom domain also needs the corresponding callback and OIDC audience updates.

The cloud service processes work only during requests. Do not start the local polling script in Cloud Run's web container. Cloud Tasks triggers requests even after the user's tab closes.

## 5. Tasks queue and recovery schedule

Create an HTTP Cloud Tasks queue named `mailflow` in the selected region. Start with maximum 5 dispatches/second and 10 concurrent dispatches; tune after measuring actual load. Configure bounded exponential retry for transient failures. Transactions and attempt records protect against duplicate task delivery, but they cannot guarantee exactly-once email acceptance.

The app creates tasks with:

```text
POST https://YOUR-APP-HOST/api/jobs/blast
Content-Type: application/json
Body: {"ownerId":"saved-workspace-owner"}
OIDC service account: BLAST_WORKER_SERVICE_ACCOUNT
OIDC audience: https://YOUR-APP-HOST
```

The audience is the origin without `/api/jobs/blast`. Do not add a shared-secret query parameter.

Create a Cloud Scheduler HTTP job every minute, using timezone `Asia/Kolkata`, with the same URL, POST method, JSON content type, body `{}`, job-invocation service account and exact origin audience. The empty body scans the next 20 due workspaces. This recovers work after a crash, lost task, failed enqueue or expired lease. Set a request deadline compatible with the hosting timeout and enable failed-job monitoring.

After creating the queue/schedule, verify a simulation from the browser, close the tab and confirm fresh worker activity/progress after reopening. Trigger recovery after deliberately stopping an in-progress test worker. Inspect logs for OIDC/IAM errors rather than weakening authentication.

## 6. Live acceptance checks

Complete these against the real project before recipient sending:

1. Signed-out/other-owner requests cannot read or mutate campaign data. Unauthorized job calls return 401. Cross-origin mutations fail.
2. OAuth state/PKCE, token refresh, disconnect/revoke and secret availability work after a fresh container starts.
3. Ownership/DNS checks and distinct registered-domain requirements pass. Six senders under one domain fail protected launch.
4. Real owned seed probes return matching Inbox/Promotions/spam outcomes. Missing results keep sending blocked. Recovery needs a post-cooldown probe.
5. Two simultaneous workers do not dispatch the same saved recipient. Pause and emergency stop survive reload/restart. A request already in flight may finish after pause.
6. A real bounce and reply are correlated to the original message. Reply/STOP and signed public unsubscribe suppress future pending sends only in the correct workspace.
7. Crash/timeout leaves an uncertain attempt held. Gmail Sent reconciliation confirms only an existing matching message; absence never authorizes a retry.
8. Verify pending-only mailbox/domain failover and shared quotas, then test only your own addresses in live mode.

Review remaining dependency advisories and public Gmail restricted-scope requirements before opening this as a public service. Cloud verification, monitoring and actual delivery results have not been established by local simulation.

## References

- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Authenticated HTTP Cloud Tasks](https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks)
- [Scheduler HTTP authentication](https://docs.cloud.google.com/scheduler/docs/http-target-auth)
- [Next.js 15.5.28 security release](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
