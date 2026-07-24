'use client';

import { CheckCircle } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';

// "Write to us" → a request-access form that posts to /api/waitlist (which forwards to the same
// Google Sheet the marketing waitlist uses). No mailto, no third-party script — keeps the auth-page
// CSP tight. Shows a confirmation on success; never hard-errors for the visitor.
type Status = 'idle' | 'loading' | 'done' | 'error';

export function WriteToUsDialog() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('loading');
    setError('');
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          name: form.get('name'),
          company: form.get('company'),
          message: form.get('message'),
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(b?.error ?? 'something went wrong');
      }
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'something went wrong');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setStatus('idle'); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          Write to us
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Request access to OGAC</DialogTitle>
        </DialogHeader>
        {status === 'done' ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle className="size-9 text-primary" weight="duotone" />
            <p className="text-sm font-medium">You&apos;re on the list.</p>
            <p className="text-sm text-muted-foreground">We&apos;ll reach out as access opens up.</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Tell us where to reach you and we&apos;ll be in touch about access.
            </p>
            <input name="email" type="email" required placeholder="work email *"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            <input name="name" type="text" placeholder="name"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            <input name="company" type="text" placeholder="company"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            <textarea name="message" rows={2} placeholder="anything you want us to know (optional)"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            {status === 'error' ? <p className="text-sm text-red-500">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={status === 'loading'}>
              {status === 'loading' ? <Spinner className="size-4" /> : 'Request access'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">No spam. Only about access.</p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
