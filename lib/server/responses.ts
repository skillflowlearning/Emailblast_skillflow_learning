import { NextResponse } from 'next/server';
export function failure(error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed.';
  return NextResponse.json({ error: message }, { status: /sign in|session expired/i.test(message) ? 401 : 400 });
}
