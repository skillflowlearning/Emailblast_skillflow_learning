import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { adminDatabase } from './admin';
import { emptyWorkspace, Workspace, WorkspaceStore } from './model';
import { localDataDirectory } from './secrets';

export function packWorkspace(workspace: Workspace): string[] {
  const json = JSON.stringify(workspace);
  if (Buffer.byteLength(json) > 8 * 1024 * 1024) throw new Error('Workspace storage limit reached. Archive old campaign data before importing more recipients.');
  // Even four-byte characters keep these chunks below Firestore's document limit.
  const chunks: string[] = [];
  for (let start = 0; start < json.length;) {
    let end = Math.min(json.length, start + 50000);
    if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1]) && /[\uDC00-\uDFFF]/.test(json[end])) end--;
    chunks.push(json.slice(start, end)); start = end;
  }
  return chunks;
}
const ownerKey = (owner: string) => createHash('sha256').update(owner).digest('hex');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class FileWorkspaceStore implements WorkspaceStore {
  constructor(private directory = localDataDirectory()) {}
  private filename(owner: string) { return path.join(this.directory, `${ownerKey(owner)}.json`); }
  async read(owner: string): Promise<Workspace> {
    try { return JSON.parse(await readFile(this.filename(owner), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyWorkspace(owner); throw error; }
  }
  async transact<T>(owner: string, change: (workspace: Workspace) => T): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const filename = this.filename(owner); const lockPath = filename + '.lock';
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    for (let retry = 0; retry < 100 && !lock; retry++) {
      try { lock = await open(lockPath, 'wx', 0o600); await lock.writeFile(JSON.stringify({ pid: process.pid })); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const lockText = await readFile(lockPath, 'utf8');
          const pid = lockText ? JSON.parse(lockText).pid as number : undefined;
          if (pid) { try { process.kill(pid, 0); } catch (probe) { if ((probe as NodeJS.ErrnoException).code === 'ESRCH') await unlink(lockPath); } }
          else if (Date.now() - (await stat(lockPath)).mtimeMs > 30000) await unlink(lockPath);
        } catch { /* Another process can release the lock while it is inspected. */ }
        await sleep(100);
      }
    }
    if (!lock) throw new Error('Local storage is busy. If a process crashed, stop local workers and remove only its stale .lock file.');
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      const workspace = await this.read(owner);
      const before = JSON.stringify(workspace);
      const result = change(workspace);
      if (before === JSON.stringify(workspace)) return result;
      workspace.version++;
      packWorkspace(workspace);
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(workspace)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, filename);
      return result;
    } finally {
      await lock.close(); await unlink(lockPath);
      await unlink(temporary).catch(() => {});
    }
  }
  async dueOwners(now: number) {
    await mkdir(this.directory, { recursive: true });
    const owners: string[] = [];
    for (const filename of await readdir(this.directory)) if (/^[a-f0-9]{64}\.json$/.test(filename)) {
      const workspace: Workspace = JSON.parse(await readFile(path.join(this.directory, filename), 'utf8'));
      if (workspace.nextDueAt <= now) owners.push(workspace.ownerId);
    }
    return owners.slice(0, 20);
  }
}

export class FirestoreWorkspaceStore implements WorkspaceStore {
  private root(owner: string) { return adminDatabase().collection('blastWorkspaces').doc(ownerKey(owner)); }
  async read(owner: string): Promise<Workspace> {
    // The manifest and chunks must come from one consistent transaction snapshot.
    return adminDatabase().runTransaction(async (transaction) => {
      const root = this.root(owner); const manifest = await transaction.get(root);
      if (!manifest.exists) return emptyWorkspace(owner);
      const count = manifest.get('chunkCount') as number;
      const chunks = await transaction.getAll(...Array.from({ length: count }, (_, i) => root.collection('chunks').doc(String(i))));
      return JSON.parse(chunks.map((chunk) => chunk.get('text')).join('')) as Workspace;
    });
  }
  async transact<T>(owner: string, change: (workspace: Workspace) => T): Promise<T> {
    return adminDatabase().runTransaction(async (transaction) => {
      const root = this.root(owner); const manifest = await transaction.get(root);
      const count = manifest.exists ? manifest.get('chunkCount') as number : 0;
      const snapshots = count ? await transaction.getAll(...Array.from({ length: count }, (_, i) => root.collection('chunks').doc(String(i)))) : [];
      const old = snapshots.map((snapshot) => snapshot.get('text') as string);
      const workspace = count ? JSON.parse(old.join('')) as Workspace : emptyWorkspace(owner);
      const before = JSON.stringify(workspace);
      const result = change(workspace);
      if (before === JSON.stringify(workspace)) return result;
      workspace.version++;
      const chunks = packWorkspace(workspace);
      for (let i = 0; i < chunks.length; i++) if (chunks[i] !== old[i]) transaction.set(root.collection('chunks').doc(String(i)), { text: chunks[i] });
      for (let i = chunks.length; i < count; i++) transaction.delete(root.collection('chunks').doc(String(i)));
      transaction.set(root, { ownerId: owner, chunkCount: chunks.length, nextDueAt: workspace.nextDueAt, version: workspace.version });
      return result;
    });
  }
  async dueOwners(now: number) {
    const snapshot = await adminDatabase().collection('blastWorkspaces').where('nextDueAt', '<=', now).orderBy('nextDueAt').limit(20).get();
    return snapshot.docs.map((doc) => doc.get('ownerId') as string);
  }
}

export function workspaceStore(): WorkspaceStore {
  if (process.env.BLAST_STORAGE === 'firestore') return new FirestoreWorkspaceStore();
  if (process.env.NODE_ENV === 'production') throw new Error('Production requires BLAST_STORAGE=firestore and Firebase Admin credentials.');
  return new FileWorkspaceStore();
}
