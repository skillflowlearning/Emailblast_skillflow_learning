'use client';
import { useEffect, useState } from 'react';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { browserAuth } from '@/lib/firebase';
import { getSession } from '@/lib/client/api';
import { Button } from '@/components/ui/button';

export default function AccountPanel() {
  const [session, setSession] = useState<{ authenticated: boolean; mode: string }>();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { getSession().then(setSession).catch(() => setError('Account setup is unavailable.')); }, []);
  const login = async () => {
    setBusy(true); setError('');
    try {
      const result = await signInWithPopup(await browserAuth(), new GoogleAuthProvider());
      const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: await result.user.getIdToken() }) });
      if (!response.ok) throw new Error('Firebase sign-in could not be verified. Check your project setup.');
      await getSession(true); window.location.reload();
    } catch (error) { setError(error instanceof Error ? error.message : 'Sign-in failed'); } finally { setBusy(false); }
  };
  const logout = async () => { await fetch('/api/session', { method: 'DELETE' }); await signOut(await browserAuth()); await getSession(true); window.location.reload(); };
  return <div className="p-4 border-t border-gray-100 space-y-2 text-xs text-gray-500">
    <p>{session?.mode === 'local' ? 'Local workspace • saved on this computer' : session?.authenticated ? 'Signed in • private workspace' : 'Sign in to save and manage campaigns'}</p>
    {session?.mode !== 'local' && <Button size="sm" variant="outline" disabled={busy} onClick={session?.authenticated ? logout : login}>{session?.authenticated ? 'Sign out' : 'Sign in with Google'}</Button>}
    <a className="block underline" href="/setup">Setup guide</a>
    {error && <p className="text-red-600 break-words">{error}</p>}
  </div>;
}
