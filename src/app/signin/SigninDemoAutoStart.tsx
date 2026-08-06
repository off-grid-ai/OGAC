'use client';

import { useEffect, useRef, useState } from 'react';

// ─── Demo links sign themselves in ────────────────────────────────────────────────────────────────
//
// A public demo link goes to an investor or a buyer who has never seen this product. Landing them on
// a login form and asking them to copy a username and password off the banner above it is a step that
// can only lose people — and it is a pointless one, because those credentials are PRINTED ON THE SAME
// PAGE. Auto-submitting them discloses nothing that was not already on screen; it just removes the
// friction.
//
// It reuses the existing credential server action rather than adding an auth path of its own, so the
// tenant-login gate still applies (a bank credential cannot sign into the insurer host) and there is
// exactly one way into the console.
//
// TWO GUARDS, both about not trapping the visitor:
//
//   • `disabled` is set by the server when the URL carries an auth error. Without it a failed sign-in
//     redirects back to /signin?error=1, which would auto-submit again — an infinite loop that looks
//     like a hung page rather than a rejected login.
//   • Signing out lands back here, and auto-starting would sign the visitor straight back in, making
//     sign-out impossible. `?signin=manual` (which the sign-out flow appends) suppresses it.
//
// It renders the form and a status line rather than nothing, so a visitor with JavaScript disabled —
// or one where the submit fails — still sees a working way in, instead of a blank page.

export function SigninDemoAutoStart({
  email,
  password,
  callbackUrl,
  action,
  disabled,
}: Readonly<{
  email: string;
  password: string;
  callbackUrl: string;
  action: (formData: FormData) => Promise<void>;
  disabled: boolean;
}>) {
  const formRef = useRef<HTMLFormElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (disabled || started) return;
    if (new URLSearchParams(window.location.search).get('signin') === 'manual') return;
    setStarted(true);
    // A tick, so the form is in the DOM and React has flushed before the submit.
    const id = window.setTimeout(() => formRef.current?.requestSubmit(), 50);
    return () => window.clearTimeout(id);
  }, [disabled, started]);

  return (
    <form ref={formRef} action={action} className="w-full max-w-sm">
      <input type="hidden" name="username" value={email} readOnly />
      <input type="hidden" name="password" value={password} readOnly />
      <input type="hidden" name="callbackUrl" value={callbackUrl} readOnly />
      <button
        type="submit"
        className="w-full rounded-md border border-primary bg-primary px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-90"
      >
        {started ? 'Signing you in…' : 'Enter the read-only demo'}
      </button>
    </form>
  );
}
