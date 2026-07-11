'use client';

import { FloppyDisk as Save } from '@phosphor-icons/react/dist/ssr';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  buildPipelineOptions,
  toBindingRequestBody,
  validateBinding,
  type WorkspacePipelineOption,
} from '@/lib/workspace-pipeline-binding';

// Admin surface: bind the WORKSPACE (Chat & Projects) to a governed pipeline. Sets the org-DEFAULT
// pipeline every chat runs on + the SET a user may pick per-project (users may only choose from this
// set — no ungoverned binding). Persists via PUT /api/v1/admin/org-settings. Pure options/validation
// live in src/lib/workspace-pipeline-binding.ts; this component is the thin I/O + presentation layer.
export function WorkspacePipelineBinding({
  initial,
  pipelines,
}: Readonly<{
  initial: { defaultChatPipelineId: string | null; allowlist: string[] };
  pipelines: WorkspacePipelineOption[];
}>) {
  const options = useMemo(() => buildPipelineOptions(pipelines), [pipelines]);
  const knownIds = useMemo(() => options.map((o) => o.id), [options]);

  const [defaultId, setDefaultId] = useState<string>(initial.defaultChatPipelineId ?? '');
  const [allow, setAllow] = useState<Set<string>>(new Set(initial.allowlist));
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setAllow((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    const body = toBindingRequestBody(defaultId || null, Array.from(allow), knownIds);
    const err = validateBinding(body, knownIds);
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/org-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        // Reflect the normalized allowlist (default is always implicitly allowed) back into the UI.
        setAllow(new Set(body.chatPipelineAllowlist));
        toast.success('Workspace pipeline binding saved');
      } else {
        toast.error('Could not save — check your permissions and try again.');
      }
    } catch {
      toast.error('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No governed pipelines exist yet. Create one under Governance → Pipelines, then come back to
        choose which pipeline Chat &amp; Projects should use.
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Org-default Workspace pipeline */}
      <div className="space-y-2">
        <label
          htmlFor="workspace-default-pipeline"
          className="block text-sm font-medium text-foreground"
        >
          Which governed pipeline should Chat &amp; Projects use by default?
        </label>
        <p className="text-xs text-muted-foreground">
          Every conversation runs on this pipeline — its policy, guardrails, cost controls and
          observability — unless a project is set to use a different one. Leave it on the per-message
          model if you don&apos;t want a governed default yet.
        </p>
        <select
          id="workspace-default-pipeline"
          value={defaultId}
          onChange={(e) => setDefaultId(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">No default — use the model chosen per message</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.status && p.status !== 'published' ? ` (${p.status})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Per-project allowlist */}
      <div className="space-y-2">
        <span className="block text-sm font-medium text-foreground">
          Which pipelines may a project be switched to?
        </span>
        <p className="text-xs text-muted-foreground">
          People running a project can only pick from the pipelines you tick here — anything unticked
          can&apos;t be chosen, so every message stays governed. The default above is always
          available, even if it isn&apos;t ticked.
        </p>
        <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-border p-3">
          {options.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={allow.has(p.id) || defaultId === p.id}
                disabled={defaultId === p.id}
                onChange={() => toggle(p.id)}
                className="size-4 accent-[var(--primary)]"
              />
              <span className="text-foreground">{p.name}</span>
              {p.status && p.status !== 'published' ? (
                <Badge variant="secondary" className="text-[10px]">
                  {p.status}
                </Badge>
              ) : null}
              {defaultId === p.id ? (
                <Badge variant="secondary" className="bg-primary/10 text-[10px] text-primary">
                  default
                </Badge>
              ) : null}
            </label>
          ))}
        </div>
      </div>

      <div className="lg:col-span-2">
        <Button size="sm" onClick={save} disabled={busy}>
          <Save className="size-4" />
          {busy ? 'Saving…' : 'Save Workspace pipeline binding'}
        </Button>
      </div>
    </div>
  );
}
