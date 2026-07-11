'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

// ─── PUBLIC invite-accept page ──────────────────────────────────────────────────────────────────────
// The invitee lands here from the email link (…/invite/accept?token=…). We POST the token to the
// public accept endpoint, which provisions their Keycloak user + applies grants + consumes the invite,
// then hand them to sign-in where Keycloak forces set-password + verify-email. No session needed here.

type Phase = 'idle' | 'accepting' | 'done' | 'error' | 'missing';

export default function InviteAcceptPage() {
  // useSearchParams must sit under a Suspense boundary for the static build to succeed.
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen w-full items-center justify-center bg-background p-6">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </main>
      }
    >
      <InviteAcceptInner />
    </Suspense>
  );
}

function InviteAcceptInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';

  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState<string | undefined>();

  async function accept(): Promise<void> {
    if (!token) {
      setPhase('missing');
      return;
    }
    setPhase('accepting');
    try {
      const res = await fetch('/api/v1/invites/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        email?: string;
      };
      if (res.ok && data.ok) {
        setEmail(data.email);
        setMessage(data.message ?? 'Your invitation has been accepted.');
        setPhase('done');
      } else {
        setMessage(data.message ?? 'This invitation link is not valid.');
        setPhase('error');
      }
    } catch {
      setMessage('Something went wrong accepting your invitation. Please try again.');
      setPhase('error');
    }
  }

  // Auto-accept on load when a token is present (the link is the intent). No token → prompt state.
  useEffect(() => {
    if (!token) setPhase('missing');
    else void accept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        <div className="space-y-1">
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Off Grid AI</p>
          <h1 className="text-lg font-semibold text-foreground">Accept your invitation</h1>
        </div>

        {phase === 'accepting' && (
          <p className="text-sm text-muted-foreground">Setting up your account…</p>
        )}

        {phase === 'done' && (
          <div className="space-y-4">
            <p className="text-sm text-foreground">{message}</p>
            {email && (
              <p className="text-xs text-muted-foreground">
                Sign in with <span className="font-mono text-foreground">{email}</span>. You&apos;ll be
                asked to set a password and verify your email the first time.
              </p>
            )}
            <Button className="w-full" onClick={() => router.push('/signin')}>
              Continue to sign in
            </Button>
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-4">
            <p className="text-sm text-destructive">{message}</p>
            <p className="text-xs text-muted-foreground">
              Ask whoever invited you to send a fresh invitation.
            </p>
            <Button variant="outline" className="w-full" onClick={() => void accept()}>
              Try again
            </Button>
          </div>
        )}

        {phase === 'missing' && (
          <p className="text-sm text-destructive">
            This link is missing its invitation token. Please open the link from your invitation email
            exactly as it was sent.
          </p>
        )}
      </div>
    </main>
  );
}
