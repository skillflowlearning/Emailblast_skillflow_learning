let session: Promise<{ authenticated: boolean; mode: string }> | undefined;
export function getSession(reset = false) {
  if (reset) session = undefined;
  session ||= fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' }).then((response) => response.json());
  return session;
}
export async function api<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T> {
  const current = await getSession();
  if (!current.authenticated) throw new Error('Sign in with Google to access your workspace.');
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result as T;
}
