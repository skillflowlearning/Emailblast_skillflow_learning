import AppLayout from '@/components/layout/AppLayout';
export default function SetupPage() {
  return <AppLayout><main className="max-w-3xl mx-auto space-y-6 pb-12 text-sm leading-relaxed">
    <h1 className="text-3xl font-bold">SkillFlow setup guide</h1>
    <p>Local simulations already save to this computer. Run the background worker alongside the app to continue processing after a browser tab closes.</p>
    <ol className="list-decimal pl-5 space-y-5">
      <li><strong>Buy and configure sending domains.</strong> Keep the main website separate. For automatic domain failover, use at least two different registered domains. Create independent Google Workspace mailboxes and an additional spare.</li>
      <li><strong>Configure domain email.</strong> Add domains as secondary domains in Google Workspace. Set up MX, SPF, DKIM and DMARC. Add each domain on the Domains page and copy its ownership TXT record to your DNS provider.</li>
      <li><strong>Create a Firebase/Google Cloud project.</strong> Enable Firestore and Firebase Authentication with Google sign-in. Create a web app and configure its Firebase values on the server. For production, use Firestore storage and Firebase Admin credentials through the hosting service identity.</li>
      <li><strong>Enable Gmail API and create a Google OAuth web client.</strong> Add the exact app URL and callback <code>/api/google/callback</code>. For localhost, use <code>http://localhost:3000/api/google/callback</code>. Configure client ID and secret on the server. Public Gmail read access needs Google’s verification process.</li>
      <li><strong>Connect owned accounts.</strong> Connect sending mailboxes and a separate owned Gmail or Workspace seed inbox on the Domains page. The app requests permission; it never asks for mailbox passwords.</li>
      <li><strong>Run health probes.</strong> A real test message goes to your owned seed inbox. Wait for the worker to check its matching token and actual folder. Activate healthy mailboxes and keep one as spare.</li>
      <li><strong>Deploy the worker.</strong> Configure Cloud Tasks and an authenticated Cloud Scheduler recovery trigger. Their service account must be authorized to invoke the worker. Keep live mode disabled until storage, scheduling, DNS and health checks pass.</li>
      <li><strong>Live test.</strong> Enable live mode only after setup and test using your own addresses. The simulation build is not evidence of real deliverability.</li>
    </ol>
    <p className="rounded-xl bg-blue-50 p-4">Credentials belong in the local environment or hosting secret store. Do not paste private keys, OAuth secrets, or refresh tokens into chat or commit them to GitHub.</p>
    <div className="flex gap-4 flex-wrap underline"><a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer">Firebase console</a><a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud console</a><a href="https://admin.google.com/" target="_blank" rel="noreferrer">Workspace Admin</a><a href="/domains">Domains & health checks</a></div>
  </main></AppLayout>;
}
