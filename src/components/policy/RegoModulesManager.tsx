'use client';

import { CheckCircle, FloppyDisk, Plus, Trash, X, XCircle } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  type RegoCompileError,
  type RegoModule,
  STARTER_REGO,
  slugifyModuleId,
} from '@/lib/opa-policy-policy';

// Full management surface for OPA Rego modules — the ADVANCED policy-as-code path (the first-party
// ABAC engine, shown in the other tab, remains the default). List / create / edit / validate /
// deploy / delete-with-confirm. Editing opens an INLINE side panel (NOT a modal), driven by the URL
// (?module=new | ?module=<id>) so Back closes it and the view is deep-linkable — never local-only
// navigational state.

export function RegoModulesManager({
  modules,
  reachable,
  reason,
}: {
  modules: RegoModule[];
  reachable: boolean;
  reason?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get('module'); // null | 'new' | '<id>'

  const setSelected = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set('module', id);
      else next.delete('module');
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const current = useMemo(
    () => (selected && selected !== 'new' ? modules.find((m) => m.id === selected) : undefined),
    [selected, modules],
  );

  if (!reachable) {
    return (
      <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        The policy engine is not reachable{reason ? ` (${reason})` : ''}. Set{' '}
        <span className="font-mono">OFFGRID_OPA_URL</span> to author, validate, and deploy
        policy-as-code modules. The first-party ABAC engine keeps serving decisions in the meantime.
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,1.1fr)]">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Policy-as-code modules compiled and stored by the policy engine, validated on deploy.
          </p>
          <Button size="sm" onClick={() => setSelected('new')}>
            <Plus className="size-4" /> New module
          </Button>
        </div>

        {modules.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            No policy-as-code modules yet. Create one to author a policy-as-code rule.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Module id</TableHead>
                <TableHead>Package</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {modules.map((m) => (
                <TableRow key={m.id} data-state={selected === m.id ? 'selected' : undefined}>
                  <TableCell>
                    <button
                      type="button"
                      className="text-left font-mono text-sm hover:underline"
                      onClick={() => setSelected(m.id)}
                    >
                      {m.id}
                    </button>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {m.package || '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeleteButton id={m.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {selected != null ? (
        <ModulePanel
          key={selected}
          module={current}
          isNew={selected === 'new'}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/policy/modules/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'failed');
      toast.success(`Deleted module "${id}"`);
      // If the deleted module was open in the panel, close it.
      if (params.get('module') === id) {
        const next = new URLSearchParams(params.toString());
        next.delete('module');
        router.replace(`?${next.toString()}`, { scroll: false });
      }
      router.refresh();
    } catch (e) {
      toast.error(`Failed to delete: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }
  if (confirm) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Delete?</span>
        <Button size="sm" variant="destructive" onClick={remove} disabled={busy}>
          {busy ? '…' : 'Yes'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirm(false)} disabled={busy}>
          No
        </Button>
      </span>
    );
  }
  return (
    <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} aria-label="Delete module">
      <Trash className="size-4" />
    </Button>
  );
}

function ModulePanel({
  module,
  isNew,
  onClose,
}: {
  module: RegoModule | undefined;
  isNew: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [id, setId] = useState(module?.id ?? '');
  const [rego, setRego] = useState(module?.rego ?? (isNew ? STARTER_REGO : ''));
  const [busy, setBusy] = useState<'save' | 'validate' | null>(null);
  const [errors, setErrors] = useState<RegoCompileError[]>([]);
  const [validState, setValidState] = useState<'valid' | 'invalid' | null>(null);
  // Existing modules can't rename (the id is the OPA path); only new modules take an id input.
  const editingId = !isNew;

  // For a brand-new module we haven't loaded source over the wire (the list only has id+package for
  // existing ones). When editing an existing module, the list row already carries its raw source.
  useEffect(() => {
    if (isNew && !id) setId('');
  }, [isNew, id]);

  const derivedId = isNew ? id.trim() || slugifyModuleId(id) : (module?.id ?? '');

  async function validate() {
    setBusy('validate');
    setErrors([]);
    setValidState(null);
    try {
      const res = await fetch('/api/v1/admin/policy/modules/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: derivedId || 'draft', rego }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.valid) {
        setValidState('valid');
        toast.success('Policy compiles cleanly');
      } else {
        setValidState('invalid');
        setErrors(body.errors ?? []);
        toast.error(body.error ?? 'Invalid policy source');
      }
    } catch (e) {
      toast.error(`Validate failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    setErrors([]);
    setValidState(null);
    try {
      const res = editingId
        ? await fetch(`/api/v1/admin/policy/modules/${encodeURIComponent(module!.id)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rego }),
          })
        : await fetch('/api/v1/admin/policy/modules', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: derivedId, rego }),
          });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(body.errors) && body.errors.length) {
          setValidState('invalid');
          setErrors(body.errors);
        }
        throw new Error(body?.error ?? 'failed');
      }
      toast.success(editingId ? `Deployed "${module!.id}"` : `Deployed "${derivedId}"`);
      onClose();
      router.refresh();
    } catch (e) {
      toast.error(`Deploy failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {editingId ? `Edit ${module?.id}` : 'New policy-as-code module'}
        </h3>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close panel">
          <X className="size-4" />
        </Button>
      </div>

      <div className="space-y-3">
        {isNew ? (
          <div className="space-y-1.5">
            <Label htmlFor="rego-id">Module id</Label>
            <Input
              id="rego-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="offgrid/authz or my-policy"
              className="font-mono"
            />
            {derivedId && derivedId !== id ? (
              <p className="text-xs text-muted-foreground">
                will deploy as <span className="font-mono">{derivedId}</span>
              </p>
            ) : null}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            id <span className="font-mono">{module?.id}</span> — package{' '}
            <span className="font-mono">{module?.package || '—'}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="rego-src">Policy source</Label>
          <Textarea
            id="rego-src"
            value={rego}
            onChange={(e) => {
              setRego(e.target.value);
              setValidState(null);
            }}
            rows={16}
            spellCheck={false}
            className="font-mono text-xs"
            placeholder="package offgrid.authz"
          />
        </div>

        {validState === 'valid' ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle className="size-4" /> Policy compiles cleanly.
          </div>
        ) : null}

        {errors.length ? (
          <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <XCircle className="size-4" /> Compile errors
            </div>
            <ul className="space-y-0.5 font-mono text-xs text-destructive">
              {errors.map((e, i) => (
                <li key={`${e.code}-${i}`}>
                  {e.location ? `${e.location} ` : ''}
                  {e.code}: {e.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={validate} disabled={busy !== null || !rego}>
            {busy === 'validate' ? 'Validating…' : 'Validate'}
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={busy !== null || !rego || (isNew && !derivedId)}
          >
            <FloppyDisk className="size-4" />
            {busy === 'save' ? 'Deploying…' : 'Deploy'}
          </Button>
        </div>
      </div>
    </div>
  );
}
