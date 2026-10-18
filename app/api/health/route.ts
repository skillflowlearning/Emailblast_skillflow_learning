import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const outcome = (error: NodeJS.ErrnoException) => ({
    code: error.code || error.name,
    packages: [...new Set((error.message.match(/node_modules[/\\](?:@[^/\\]+[/\\])?[^/\\\s]+/g) || []).map((part) => part.replace(/^node_modules[/\\]/, '').replaceAll('\\', '/')))],
  });
  const checks = await Promise.all([
    import('@/lib/server/admin').then(() => 'ok', outcome),
    import('@/lib/server/auth').then(() => 'ok', outcome),
    import('@/lib/server/store').then(() => 'ok', outcome),
    import('@/lib/temporary-test/server').then(() => 'ok', outcome),
  ]);
  return NextResponse.json({ ok: true, checks: { admin: checks[0], auth: checks[1], store: checks[2], temporaryTest: checks[3] } });
}
