import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function localDataDirectory() { return path.resolve(process.env.BLAST_LOCAL_DATA_DIR || path.join(process.cwd(), '.mailflow-local')); }

export async function applicationSecret(): Promise<string> {
  if (process.env.BLAST_APP_SECRET && process.env.BLAST_APP_SECRET.length >= 32) return process.env.BLAST_APP_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('BLAST_APP_SECRET must be configured with at least 32 random characters.');
  const directory = localDataDirectory();
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'secret');
  try { return await readFile(filename, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const secret = randomBytes(48).toString('base64url');
    try { await writeFile(filename, secret, { flag: 'wx', mode: 0o600 }); return secret; }
    catch (writeError) { if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError; return readFile(filename, 'utf8'); }
  }
}
export function equalSecret(a: string, b: string) {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function seal(value: unknown): Promise<string> {
  const key = createHash('sha256').update('mailflow-token:' + await applicationSecret()).digest();
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes].map((part) => part.toString('base64url')).join('.');
}
export async function unseal<T>(value: string): Promise<T> {
  const [iv, tag, bytes] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  const key = createHash('sha256').update('mailflow-token:' + await applicationSecret()).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(bytes), decipher.final()]).toString('utf8')) as T;
}
export async function signature(value: string) {
  return createHmac('sha256', await applicationSecret()).update(value).digest('base64url');
}
