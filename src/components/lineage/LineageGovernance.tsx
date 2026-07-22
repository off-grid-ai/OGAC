'use client';

import { PencilSimple, Tag, UserCircle } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { NamespaceOwnershipView, TagView } from '@/lib/marquez-lineage';

// Governance / ownership management for the lineage graph — the audit backbone's "who owns this"
// and "how is it classified" controls. Namespaces get an editable OWNER (create-or-update via the
// idempotent PUT); tags are declared centrally. Full CRUD-style management, not a read-only list.

interface Props {
  namespaces: NamespaceOwnershipView[];
  tags: TagView[];
}

export function LineageGovernance({ namespaces, tags }: Readonly<Props>) {
  return (
    <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-2">
      <NamespaceOwnership namespaces={namespaces} />
      <TagRegistry tags={tags} />
    </div>
  );
}

function NamespaceOwnership({ namespaces }: Readonly<{ namespaces: NamespaceOwnershipView[] }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <UserCircle className="size-4 text-primary" />
          Namespace ownership ({namespaces.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Assign an accountable owner to each lineage namespace. Provenance answers &ldquo;who owns
          the dataset lineage&rdquo; — set it here.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {namespaces.length ? (
          namespaces.map((ns) => <OwnerRow key={ns.name} ns={ns} />)
        ) : (
          <p className="text-xs text-muted-foreground">No namespaces in the lineage store.</p>
        )}
      </CardContent>
    </Card>
  );
}

function OwnerRow({ ns }: Readonly<{ ns: NamespaceOwnershipView }>) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [owner, setOwner] = useState(ns.ownerName ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!owner.trim()) {
      toast.error('Owner required.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/data/lineage/namespaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: ns.name,
          ownerName: owner.trim(),
          description: ns.description ?? undefined,
        }),
      });
      if (res.status === 403) return void toast.error('Admins only.');
      if (!res.ok) return void toast.error('Failed to set owner.');
      toast.success(`Owner set for ${ns.name}.`);
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
      <span className="truncate font-mono text-xs text-foreground" title={ns.name}>
        {ns.name}
      </span>
      {editing ? (
        <>
          <Input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="data-governance"
            className="ml-auto h-7 w-40 font-mono text-xs"
          />
          <Button size="sm" className="h-7" onClick={save} disabled={busy}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => {
              setEditing(false);
              setOwner(ns.ownerName ?? '');
            }}
          >
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Badge variant="outline" className="ml-auto text-[10px]">
            {ns.ownerName ?? 'unassigned'}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1"
            onClick={() => setEditing(true)}
          >
            <PencilSimple className="size-3" />
            Owner
          </Button>
        </>
      )}
    </div>
  );
}

function TagRegistry({ tags }: Readonly<{ tags: TagView[] }>) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);

  async function declare() {
    if (!name.trim()) {
      toast.error('Tag name required.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/data/lineage/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'declare', name: name.trim(), description: desc.trim() }),
      });
      if (res.status === 403) return void toast.error('Admins only.');
      if (!res.ok) return void toast.error('Failed to declare tag.');
      toast.success('Tag declared.');
      setName('');
      setDesc('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Tag className="size-4 text-primary" />
          Tag registry ({tags.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Declare classification tags (PII, SENSITIVE, GOVERNED…) once, then apply them to datasets
          and jobs from the dataset catalog.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Tag name
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="GOVERNED"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Description (optional)
            </Label>
            <Input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="reviewed for compliance"
              className="text-xs"
            />
          </div>
          <Button onClick={declare} disabled={busy} className="gap-1.5">
            <Tag className="size-4" />
            Declare
          </Button>
        </div>

        <div className="space-y-1.5 border-t border-border pt-3">
          {tags.length ? (
            tags.map((t) => (
              <div
                key={t.name}
                className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
              >
                <Badge variant="secondary" className="bg-primary/10 font-mono text-[10px] text-primary">
                  {t.name}
                </Badge>
                <span className="truncate text-xs text-muted-foreground">
                  {t.description ?? 'No description'}
                </span>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No tags declared yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
