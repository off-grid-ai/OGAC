'use client';

import { Check, FloppyDisk as Save, X } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  GUARDRAIL_OPTIONS,
  type ModelOption,
  isKnownGuardrail,
  isKnownModel,
} from '@/lib/policy-catalog';
import type { PolicyBundle } from '@/lib/store';

// ─── Constrained option shape shared by both pickers ─────────────────────────────────────────────
interface Option {
  id: string;
  label: string;
  hint?: string;
  /** Optional right-aligned tag (e.g. "served" / family) shown in the dropdown row. */
  tag?: string;
}

// A combobox that ONLY lets the operator add values from a KNOWN set — the fix for the top defect,
// where free-text accepted any garbage and published it org-wide. Typing filters the known options;
// a value is added only by selecting a real option (Enter selects the single exact/first match).
// Anything not in the set is rejected — no silent accept. Selected values render as removable chips.
function ConstrainedPicker({
  label,
  hint,
  emptyHint,
  options,
  selected,
  onChange,
  isKnown,
}: {
  label: string;
  hint: string;
  /** Shown when the known-option set is empty (e.g. no fleet models loaded). */
  emptyHint: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  isKnown: (v: string) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

  // Candidates: known options not already selected, filtered by the query (id / label / hint).
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((o) => {
      if (selected.includes(o.id)) return false;
      if (!q) return true;
      return (
        o.id.toLowerCase().includes(q) ||
        o.label.toLowerCase().includes(q) ||
        (o.hint ?? '').toLowerCase().includes(q)
      );
    });
  }, [options, selected, query]);

  function add(id: string) {
    // Hard guard: never add a value that isn't a real, enforceable option.
    if (!isKnown(id)) {
      toast.error(
        `"${id}" isn’t a known ${label.toLowerCase().replace(/s$/, '')} — pick from the list.`,
      );
      return;
    }
    if (!selected.includes(id)) onChange([...selected, id]);
    setQuery('');
    setOpen(false);
  }

  function onEnter() {
    const q = query.trim();
    if (!q) return;
    // Prefer an exact id/label match; else the single remaining candidate; else reject.
    const exact = candidates.find(
      (o) => o.id.toLowerCase() === q.toLowerCase() || o.label.toLowerCase() === q.toLowerCase(),
    );
    if (exact) return add(exact.id);
    if (candidates.length === 1) return add(candidates[0].id);
    toast.error(`No matching ${label.toLowerCase()} — pick one from the list.`);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground/80">{hint}</p>

      {/* Selected values as removable chips (label, not raw id, when we know it). */}
      <div className="flex flex-wrap gap-1.5">
        {selected.length === 0 ? (
          <span className="text-xs text-muted-foreground/60">None selected.</span>
        ) : (
          selected.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1">
              {byId.get(id)?.label ?? id}
              <button
                type="button"
                aria-label={`Remove ${byId.get(id)?.label ?? id}`}
                onClick={() => onChange(selected.filter((s) => s !== id))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))
        )}
      </div>

      {/* Constrained combobox: filter + pick. */}
      <div className="relative">
        <Input
          value={query}
          placeholder={options.length ? `Search ${label.toLowerCase()}…` : emptyHint}
          disabled={options.length === 0}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onEnter();
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          className="h-8"
          aria-label={`Add ${label.toLowerCase()}`}
        />
        {open && options.length > 0 ? (
          <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md">
            {candidates.length === 0 ? (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">
                {query.trim() ? 'No match — only known values can be added.' : 'All added.'}
              </li>
            ) : (
              candidates.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    // onMouseDown (not onClick) so it fires before the input's onBlur closes the list.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      add(o.id);
                    }}
                    className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <Check className="mt-0.5 size-3.5 shrink-0 opacity-0" />
                    <span className="flex-1">
                      <span className="font-medium text-foreground">{o.label}</span>
                      {o.hint ? (
                        <span className="block text-xs text-muted-foreground">{o.hint}</span>
                      ) : null}
                    </span>
                    {o.tag ? (
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                        {o.tag}
                      </Badge>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function PolicyEditor({
  initial,
  modelOptions,
  fleetModelTags,
}: {
  initial: PolicyBundle;
  /** Pickable models: MODEL_CATALOG ∪ live fleet-served, from the server (policy-catalog). */
  modelOptions: ModelOption[];
  /** Live fleet routing tags — the union side of the known-model guard. */
  fleetModelTags: string[];
}) {
  const router = useRouter();
  const [egress, setEgress] = useState(initial.egressAllowed);
  // Keep only values that are actually enforceable — a legacy policy may hold stale garbage; we
  // never re-surface unknowns as if they were valid.
  const [guardrails, setGuardrails] = useState(initial.guardrails.filter(isKnownGuardrail));
  const [models, setModels] = useState(
    initial.allowedModels.filter((m) => isKnownModel(m, fleetModelTags)),
  );
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(initial.version);

  const guardrailOpts: Option[] = useMemo(
    () => GUARDRAIL_OPTIONS.map((g) => ({ id: g.id, label: g.label, hint: g.hint })),
    [],
  );
  const modelOpts: Option[] = useMemo(
    () =>
      modelOptions.map((m) => ({
        id: m.id,
        label: m.name,
        hint: m.id,
        tag: m.servedOnFleet ? 'served' : m.family,
      })),
    [modelOptions],
  );

  async function publish() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/policy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ egressAllowed: egress, guardrails, allowedModels: models }),
      });
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setVersion(data.version);
      // Reflect the server-sanitised result (the source of truth) back into the editor.
      if (Array.isArray(data.guardrails)) setGuardrails(data.guardrails);
      if (Array.isArray(data.allowedModels)) setModels(data.allowedModels);
      toast.success(`Policy published · v${data.version}`);
      router.refresh();
    } catch {
      toast.error('Failed to publish policy');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="space-y-0">
        <div className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Policy · v{version}</CardTitle>
          <Button size="sm" onClick={publish} disabled={busy}>
            <Save className="size-4" />
            {busy ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          The org-wide policy every enrolled node enforces. Set it here → <strong>Publish</strong>{' '}
          bumps the version → nodes converge on their next poll. See Handbook → How-tos.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
          <div>
            <p className="text-sm text-foreground">Egress to cloud</p>
            <p className="text-xs text-muted-foreground">
              Allow leashed cloud-model calls off-device.
            </p>
          </div>
          <Switch checked={egress} onCheckedChange={setEgress} aria-label="Toggle cloud egress" />
        </div>
        <ConstrainedPicker
          label="Guardrails"
          hint="Checks that run on every request. Only the checks the platform actually enforces can be selected — no free text."
          emptyHint="No guardrails available"
          options={guardrailOpts}
          selected={guardrails}
          onChange={setGuardrails}
          isKnown={isKnownGuardrail}
        />
        <ConstrainedPicker
          label="Allowed models"
          hint="Models nodes may use. Only models in the catalog or served by your fleet can be added; anything not listed is blocked."
          emptyHint="No models available — enrol a fleet node"
          options={modelOpts}
          selected={models}
          onChange={setModels}
          isKnown={(v) => isKnownModel(v, fleetModelTags)}
        />
      </CardContent>
    </Card>
  );
}
