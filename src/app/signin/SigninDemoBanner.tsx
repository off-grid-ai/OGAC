'use client';

import { Check, Copy, Eye } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import type { DemoBannerModel } from '@/lib/demo-hellobar';

// The read-only demo-credentials banner shown on the SIGNIN page. A logged-out visitor to a demo
// tenant needs these creds to sign in and tour, so this surfaces them prominently above the signin
// card with copy-to-clipboard chips. Rendered only when the pure builder says show (demo host); the
// creds render only when configured in env, otherwise just the read-only note (never crashes).
// Off Grid tokens only; brand voice (no em-dash/exclamation/curly quotes).

function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* clipboard blocked — the value is still visible to copy by hand */
      });
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-left transition-colors hover:border-primary/50"
    >
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <code className="font-mono text-xs text-foreground">{value}</code>
      {copied ? (
        <Check className="size-3 text-primary" weight="bold" />
      ) : (
        <Copy className="size-3 text-muted-foreground" />
      )}
    </button>
  );
}

export function SigninDemoBanner({ model }: { model: DemoBannerModel }) {
  if (!model.show) return null;
  const hasCreds = Boolean(model.email || model.password);

  return (
    <div className="w-full rounded-lg border border-primary/25 bg-primary/[0.06] p-4">
      <div className="flex items-start gap-3">
        <Eye className="mt-0.5 size-4 shrink-0 text-primary" weight="regular" />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-[11px] font-medium uppercase tracking-wide text-primary/80">
              Read-only demo
            </span>
            <span className="text-xs text-foreground">{model.note}</span>
          </div>
          {hasCreds ? (
            <div className="flex flex-wrap items-center gap-2">
              {model.email ? <CopyChip label="email" value={model.email} /> : null}
              {model.password ? <CopyChip label="password" value={model.password} /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
