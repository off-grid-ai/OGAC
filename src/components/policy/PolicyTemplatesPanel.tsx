'use client';

import { CheckCircle, MagnifyingGlass, Plus, Stack } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  POLICY_TEMPLATES,
  buildPolicyPayload,
  groupTemplates,
  searchTemplates,
  type PolicyTemplate,
} from '@/lib/policy-templates';

// Starter policy-template panel. A curated, searchable, grouped set of common governance rules.
// "Apply" writes through the EXISTING create path (POST /api/v1/admin/policy/rules →
// validatePolicyRule → createPolicyRule) — no new storage, no invented rule format. After applying,
// router.refresh() re-reads the server component so the new rule shows in the ABAC table; the
// operator then hits "Push / Reload to OPA" (already in the rules manager) to propagate.
export function PolicyTemplatesPanel() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [applying, setApplying] = useState<string | null>(null);

  const groups = useMemo(
    () => groupTemplates(searchTemplates([...POLICY_TEMPLATES], q)),
    [q],
  );

  async function apply(t: PolicyTemplate) {
    setApplying(t.id);
    try {
      const res = await fetch('/api/v1/admin/policy/rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPolicyPayload(t)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'failed');
      toast.success(`Applied "${t.title}" — Push to OPA to propagate`);
      router.refresh();
    } catch (e) {
      toast.error(`Could not apply: ${(e as Error).message}`);
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Ready-made governance rules. One click creates the concrete allow/deny rule below in the
          ABAC set — then Push / Reload to OPA to enforce it.
        </p>
        <div className="relative ml-auto w-full max-w-xs">
          <MagnifyingGlass className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search templates…"
            className="pl-8 font-mono"
          />
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          No templates match “{q}”.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map(({ group, items }) => (
            <section key={group} className="space-y-3">
              <div className="flex items-center gap-2">
                <Stack className="size-4 text-primary" />
                <h3 className="font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </h3>
                <span className="text-[10px] text-muted-foreground">{items.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    busy={applying === t.id}
                    onApply={() => apply(t)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  busy,
  onApply,
}: {
  template: PolicyTemplate;
  busy: boolean;
  onApply: () => void;
}) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
          <CheckCircle className="size-3.5" />
        </span>
        <span className="truncate font-mono text-sm font-medium">{template.title}</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">{template.enforces}</p>
        <div className="space-y-1 rounded border border-border/60 bg-muted/40 p-2">
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Creates rule
          </p>
          <p className="font-mono text-[11px]">
            <Badge
              variant={template.rule.effect === 'allow' ? 'default' : 'destructive'}
              className="mr-1.5 text-[10px]"
            >
              {template.rule.effect}
            </Badge>
            when {template.rule.attribute} {template.rule.operator} {template.rule.value}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            priority {template.rule.priority}
          </p>
        </div>
        <div className="mt-auto border-t border-border pt-2.5">
          <Button size="xs" className="gap-1" onClick={onApply} disabled={busy}>
            <Plus className="size-3" /> {busy ? 'Applying…' : 'Apply template'}
          </Button>
        </div>
      </div>
    </div>
  );
}
