'use client';

import { Copy, Stack } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AppLineage } from '@/lib/app-clone';
import type { TemplateVar, TemplateVarSchema } from '@/lib/app-template-vars';

// ─── AppReuseActions (SOP / template reuse) — the per-app reuse toolbar ─────────────────────────────
//
// Sits in the per-app lifecycle shell so every app carries two reuse actions:
//   • Duplicate this app  → POST /clone → a fresh private copy in this org, then open it.
//   • Publish as template → declare {{var}} placeholders + org/public visibility, POST it to the
//     org SOP library so another team can adopt it (or Unpublish to retract).
// It also surfaces the app's LINEAGE honestly ("Cloned from …" / "Adopted from template …") when set.
//
// SOLID: this is a thin client surface — it only shapes the request + renders state. The clone rule,
// the {{var}} schema validity, and the substitution all live in the pure engines behind the routes.

// A local editable row for the variable-schema builder (string default keeps the form simple).
type VarRow = TemplateVar;

const TYPE_OPTIONS: TemplateVar['type'][] = ['text', 'number', 'boolean', 'select'];

function lineageLabel(l: AppLineage): string {
  if (l.origin === 'template') {
    return `Adopted from template${l.sourceTitle ? ` “${l.sourceTitle}”` : ''}`;
  }
  return `Duplicated from${l.sourceTitle ? ` “${l.sourceTitle}”` : ' another app'}`;
}

export function AppReuseActions({
  appId,
  isTemplate,
  templateVars,
  lineage,
}: Readonly<{
  appId: string;
  isTemplate: boolean;
  templateVars: TemplateVarSchema;
  lineage: AppLineage | null;
}>) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [vars, setVars] = React.useState<VarRow[]>(templateVars.vars ?? []);
  const [visibility, setVisibility] = React.useState<'org' | 'public'>('org');

  async function duplicate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/apps/${appId}/clone`, { method: 'POST' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `duplicate failed (${res.status})`);
      }
      const clone = (await res.json()) as { id: string; title: string };
      toast.success(`Duplicated → “${clone.title}”`);
      router.push(`/solutions/apps/${clone.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addVar() {
    setVars((v) => [...v, { name: '', type: 'text' }]);
  }
  function updateVar(i: number, patch: Partial<VarRow>) {
    setVars((v) => v.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function removeVar(i: number) {
    setVars((v) => v.filter((_, idx) => idx !== i));
  }

  async function publishAsTemplate() {
    setBusy(true);
    try {
      const payload = {
        visibility,
        vars: vars
          .map((v) => ({
            ...v,
            name: v.name.trim(),
            options:
              v.type === 'select' && v.options
                ? v.options
                : v.type === 'select'
                  ? []
                  : undefined,
          }))
          .filter((v) => v.name),
      };
      const res = await fetch(`/api/v1/admin/apps/${appId}/publish-as-template`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 422) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; errors?: string[] };
        throw new Error(j.errors?.join('; ') || j.error || 'invalid template');
      }
      if (!res.ok) throw new Error(`publish failed (${res.status})`);
      toast.success('Published to the SOP library — another team can adopt it');
      setPublishOpen(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    if (!confirm('Retract this app from the SOP library? The app itself is kept.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/apps/${appId}/publish-as-template`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`unpublish failed (${res.status})`);
      toast.success('Retracted from the SOP library');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {lineage ? (
        <span
          className="rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground"
          title={`${lineageLabel(lineage)} · ${lineage.clonedAt.slice(0, 10)}`}
        >
          {lineageLabel(lineage)}
        </span>
      ) : null}

      <Button variant="outline" size="sm" onClick={duplicate} disabled={busy}>
        <Copy className="mr-1.5 size-4" /> Duplicate this app
      </Button>

      {isTemplate ? (
        <>
          <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
            In SOP library
          </span>
          <Button variant="outline" size="sm" onClick={() => setPublishOpen(true)} disabled={busy}>
            Edit variables
          </Button>
          <Button variant="ghost" size="sm" onClick={unpublish} disabled={busy}>
            Unpublish
          </Button>
        </>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setPublishOpen(true)} disabled={busy}>
          <Stack className="mr-1.5 size-4" /> Publish as template
        </Button>
      )}

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Publish as a reusable SOP template</DialogTitle>
            <DialogDescription>
              Declare the {'{{variables}}'} another team fills in when they adopt this workflow. Use a
              placeholder like <code className="font-mono">{'{{team}}'}</code> anywhere in the app’s
              text (prompts, summary, form labels); each one you use must be declared here.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Who can adopt it?</Label>
              <div className="flex gap-2">
                {(['org', 'public'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVisibility(v)}
                    className={
                      'rounded-md border px-3 py-1.5 text-xs transition-colors ' +
                      (visibility === v
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted')
                    }
                  >
                    {v === 'org' ? 'My organization' : 'Any team (public)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Variables</Label>
                <Button variant="ghost" size="sm" onClick={addVar}>
                  + Add variable
                </Button>
              </div>
              {vars.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                  No variables — the template is adopted exactly as-is. Add one if teams need to
                  customize a value (e.g. their team name or region).
                </p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {vars.map((v, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[1fr_7rem_1fr_auto]"
                    >
                      <Input
                        placeholder="name (e.g. team)"
                        value={v.name}
                        onChange={(e) => updateVar(i, { name: e.target.value })}
                        className="font-mono text-xs"
                      />
                      <select
                        value={v.type}
                        onChange={(e) =>
                          updateVar(i, { type: e.target.value as TemplateVar['type'] })
                        }
                        className="rounded-md border bg-background px-2 text-xs"
                      >
                        {TYPE_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <Input
                        placeholder="default (optional)"
                        value={v.default ?? ''}
                        onChange={(e) => updateVar(i, { default: e.target.value })}
                        className="text-xs"
                      />
                      <div className="flex items-center gap-1">
                        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={!!v.required}
                            onChange={(e) => updateVar(i, { required: e.target.checked })}
                          />
                          req
                        </label>
                        <button
                          type="button"
                          onClick={() => removeVar(i)}
                          className="text-xs text-destructive hover:underline"
                        >
                          ✕
                        </button>
                      </div>
                      {v.type === 'select' ? (
                        <Input
                          placeholder="options, comma-separated"
                          value={(v.options ?? []).join(', ')}
                          onChange={(e) =>
                            updateVar(i, {
                              options: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          className="text-xs sm:col-span-4"
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={publishAsTemplate} disabled={busy}>
              {busy ? 'Publishing…' : isTemplate ? 'Update template' : 'Publish to library'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
