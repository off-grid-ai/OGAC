'use client';

import { FloppyDisk as Save } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

// Admin editor for the GOVERNED chat binding (CONSUMERS-BIND #166): the org-DEFAULT chat pipeline
// (used when a project pins nothing) + the SET of pipelines a user may pick per-project. Users may
// only choose from this set — no ungoverned chat binding. Persists via PUT /api/v1/admin/org-settings
// { defaultChatPipelineId, chatPipelineAllowlist }.
export function OrgChatPipelineEditor({
  initial,
  pipelines,
}: {
  initial: { defaultChatPipelineId: string | null; allowlist: string[] };
  pipelines: { id: string; name: string }[];
}) {
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
    setBusy(true);
    const res = await fetch('/api/v1/admin/org-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        defaultChatPipelineId: defaultId || null,
        chatPipelineAllowlist: Array.from(allow),
      }),
    });
    setBusy(false);
    if (res.ok) toast.success('Chat pipeline governance saved');
    else toast.error('Failed to save');
  }

  if (pipelines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No pipelines defined yet. Create governed pipelines under Governance → Pipelines, then choose
        which ones chat may use here.
      </p>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Org-default chat pipeline */}
      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Org-default chat pipeline
        </label>
        <p className="text-xs text-muted-foreground">
          Every chat runs on this pipeline unless a project pins another. It&apos;s always available
          to users even if unchecked below.
        </p>
        <select
          value={defaultId}
          onChange={(e) => setDefaultId(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">None (chat ungoverned until set)</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Available-for-chat allowlist */}
      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Available for chat (per-project picks)
        </label>
        <p className="text-xs text-muted-foreground">
          The set a user may pin on a project. Anything unchecked can&apos;t be chosen — no ungoverned
          binding.
        </p>
        <div className="space-y-1.5 rounded-md border border-border p-3">
          {pipelines.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allow.has(p.id)}
                onChange={() => toggle(p.id)}
                className="size-4 accent-[var(--primary)]"
              />
              <span className="text-foreground">{p.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="lg:col-span-2">
        <Button size="sm" onClick={save} disabled={busy}>
          <Save className="size-4" />
          Save chat pipeline governance
        </Button>
      </div>
    </div>
  );
}
