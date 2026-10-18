import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const checks = await Promise.all([
    import('@/lib/server/admin').then(() => 'ok', (error: NodeJS.ErrnoException) => error.code || error.name),
    import('@/lib/server/auth').then(() => 'ok', (error: NodeJS.ErrnoException) => error.code || error.name),
    import('@/lib/server/store').then(() => 'ok', (error: NodeJS.ErrnoException) => error.code || error.name),
    import('@/lib/temporary-test/server').then(() => 'ok', (error: NodeJS.ErrnoException) => error.code || error.name),
  ]);
  return NextResponse.json({ ok: true, checks: { admin: checks[0], auth: checks[1], store: checks[2], temporaryTest: checks[3] } });
}
