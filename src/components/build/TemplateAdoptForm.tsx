'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TemplateVar } from '@/lib/app-template-vars';

// ─── TemplateAdoptForm — "Use this template" (SOP adoption) ─────────────────────────────────────────
//
// The form a team fills in to adopt a published template. Two states, both URL-driven (per the nav
// rule — the open/closed form is a history entry via ?adopt=1, so Back closes it, and the state is
// deep-linkable). On submit it POSTs the variable values to /use; the clone engine instantiates the
// workflow into the caller's org, binding the values. Honest gaps (a missing required var) are
// blocked client-side AND surfaced from the server 422 — the adoption never lands a half-bound app.
//
// SOLID: no business logic here — the substitution + gap detection live in the pure engine behind the
// route. This only collects values, opens/closes via the URL, and shows the outcome.
export function TemplateAdoptForm({
  templateId,
  title,
  vars,
  adopting,
}: Readonly<{
  templateId: string;
  title: string;
  vars: TemplateVar[];
  adopting: boolean;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(vars.map((v) => [v.name, v.default ?? ''])),
  );
  const [busy, setBusy] = React.useState(false);

  // Open / close the form by pushing ?adopt=1 onto the history stack (URL-driven, Back-coherent).
  function setAdopt(open: boolean) {
    const next = new URLSearchParams(searchParams.toString());
    if (open) next.set('adopt', '1');
    else next.delete('adopt');
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  // Required vars with no supplied value AND no default → block submit (honest, no half-bound clone).
  const missingRequired = vars.filter(
    (v) => v.required && !(values[v.name] ?? '').trim() && !(v.default ?? '').trim(),
  );

  async function adopt() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/apps/templates/${templateId}/use`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values }),
      });
      if (res.status === 422) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          bind?: { missingRequired?: string[]; unbound?: string[]; undeclared?: string[] };
        };
        const gaps = [
          j.bind?.missingRequired?.length ? `missing: ${j.bind.missingRequired.join(', ')}` : '',
          j.bind?.unbound?.length ? `unbound: ${j.bind.unbound.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('; ');
        throw new Error(gaps || j.error || 'template variables not fully bound');
      }
      if (!res.ok) throw new Error(`adoption failed (${res.status})`);
      const app = (await res.json()) as { id: string; title: string };
      toast.success(`Adopted “${title}” → “${app.title}”`);
      router.push(`/solutions/apps/${app.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!adopting) {
    return (
      <Button className="mt-4 w-full" onClick={() => setAdopt(true)}>
        Use this template
      </Button>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {vars.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No variables to fill in — adopt it exactly as published.
        </p>
      ) : (
        <div className="space-y-3">
          {vars.map((v) => (
            <div key={v.name} className="space-y-1">
              <Label htmlFor={`var-${v.name}`} className="text-xs">
                <span className="font-mono text-primary">{v.name}</span>
                {v.required ? <span className="ml-1 text-amber-600">*</span> : null}
              </Label>
              {v.type === 'select' && v.options?.length ? (
                <select
                  id={`var-${v.name}`}
                  value={values[v.name] ?? ''}
                  onChange={(e) => setValues((s) => ({ ...s, [v.name]: e.target.value }))}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">— pick —</option>
                  {v.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`var-${v.name}`}
                  type={v.type === 'number' ? 'number' : 'text'}
                  value={values[v.name] ?? ''}
                  placeholder={v.default ? `default: ${v.default}` : ''}
                  onChange={(e) => setValues((s) => ({ ...s, [v.name]: e.target.value }))}
                />
              )}
              {v.description ? (
                <p className="text-[11px] text-muted-foreground">{v.description}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {missingRequired.length > 0 ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-500">
          Fill in the required variable{missingRequired.length > 1 ? 's' : ''}:{' '}
          {missingRequired.map((v) => v.name).join(', ')}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button className="flex-1" onClick={adopt} disabled={busy || missingRequired.length > 0}>
          {busy ? 'Adopting…' : 'Adopt into my workspace'}
        </Button>
        <Button variant="ghost" onClick={() => setAdopt(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
