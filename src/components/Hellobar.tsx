'use client';

import { Eye, X } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import type { DemoBannerModel } from '@/lib/demo-hellobar';

// The read-only-demo hellobar. Rendered full-width at the top of the console when the session is the
// demo viewer role (the server layout decides via readDemoBanner and passes the model). It surfaces
// the read-only demo credentials + a one-line note that this account can view everything but change
// nothing. Dismissible per browser session (sessionStorage) so it does not nag on every navigation
// but returns on a fresh session. Off Grid tokens only; brand voice (no em-dash/exclamation/curly).

const DISMISS_KEY = 'og-hellobar-dismissed';

export function Hellobar({ model }: { model: DemoBannerModel }) {
  // Start dismissed=false; a mount effect reads sessionStorage so SSR and the first client paint
  // agree (no hydration flash), then hides it if this session already dismissed it.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === '1') setDismissed(true);
    } catch {
      /* storage unavailable — keep showing */
    }
  }, []);

  if (!model.show || dismissed) return null;

  const dismiss = (): void => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* best-effort */
    }
  };

  const hasCreds = Boolean(model.email || model.password);

  return (
    <div className="flex w-full items-center gap-3 border-b border-primary/25 bg-primary/[0.06] px-4 py-2 md:px-6">
      <Eye className="size-4 shrink-0 text-primary" weight="regular" />
      <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-primary/80">
          Read-only demo
        </span>
        <span className="text-xs text-foreground">{model.note}</span>
        {hasCreds ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {model.email ? (
              <span className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5">
                <span className="uppercase tracking-wide text-muted-foreground">email</span>
                <code className="break-all text-foreground">{model.email}</code>
              </span>
            ) : null}
            {model.password ? (
              <span className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5">
                <span className="uppercase tracking-wide text-muted-foreground">password</span>
                <code className="break-all text-foreground">{model.password}</code>
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss the read-only demo banner"
        className="shrink-0 rounded border border-transparent p-1 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
