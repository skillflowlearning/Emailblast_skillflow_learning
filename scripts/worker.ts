import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
async function main() {
  const { workspaceStore } = await import('../lib/server/store');
  const { BackgroundWorker } = await import('../lib/server/worker');
  const { enqueueOwner } = await import('../lib/server/queue');
  const store = workspaceStore(); const worker = new BackgroundWorker(store);
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
  console.log('Background worker running. Campaigns continue while the browser is closed.');
  do {
    try {
      for (const owner of await store.dueOwners(Date.now())) {
        try { await worker.processOwner(owner); await enqueueOwner(owner, store); }
        catch { console.error('A workspace operation failed; it will be checked again without retrying uncertain deliveries.'); }
      }
    } catch { console.error('Workspace storage is temporarily unavailable; retrying on the next poll.'); }
    if (process.argv.includes('--once')) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (!stopping);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
