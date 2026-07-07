'use client';

import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { slugifyTenant, TENANT_BASE_DOMAIN, tenantHost } from '@/lib/tenant-domain';
import { cn } from '@/lib/utils';

export function AddTenantButton({ modules }: { modules: { id: string; label: string }[] }) {
  const router = useRouter();
  const params = useSearchParams();
  // Open INSTANTLY from local state, then sync the URL in the background. Gating the panel purely on
  // the URL param meant it only appeared after router.replace round-tripped the (dynamic) admin page
  // — up to a second of "nothing happened" after the click. Local state opens it immediately; the URL
  // entry still lands so the panel stays deep-linkable and Back-coherent (nav-in-URL rule).
  const [localOpen, setLocalOpen] = useState(false);
  const open = localOpen || params.get('panel') === 'new-tenant';

  const setOpen = useCallback(
    (next: boolean) => {
      setLocalOpen(next);
      const p = new URLSearchParams(params.toString());
      if (next) p.set('panel', 'new-tenant');
      else p.delete('panel');
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router],
  );

  const [name, setName] = useState('');
  // Slug auto-derives from the name until the operator edits it (then we stop overriding).
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const effectiveSlug = slugTouched ? slugifyTenant(slug) : slugifyTenant(name);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function create() {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/v1/admin/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, slug: effectiveSlug, enabledModules: selected }),
      });
      if (res.ok) {
        toast.success(`Tenant "${name}" provisioned`);
        setName('');
        setSlug('');
        setSlugTouched(false);
        setSelected([]);
        setOpen(false);
        router.refresh();
      } else {
        const msg = (await res.json().catch(() => null))?.error;
        toast.error(msg ? `Failed to create tenant: ${msg}` : 'Failed to create tenant');
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add tenant
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Provision a tenant</SheetTitle>
            <SheetDescription>Pick which planes this organization gets.</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-1.5">
              <Label htmlFor="tenant-name">Organization</Label>
              <Input id="tenant-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tenant-slug">Subdomain</Label>
              <Input
                id="tenant-slug"
                value={slugTouched ? slug : effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                placeholder="wednesdaysol"
                className="font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                {effectiveSlug ? (
                  <>
                    This tenant will live at{' '}
                    <span className="text-foreground">{tenantHost(effectiveSlug)}</span>
                  </>
                ) : (
                  <>Its own subdomain on {TENANT_BASE_DOMAIN}</>
                )}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Provisioned planes</Label>
              <div className="flex flex-wrap gap-1.5">
                {modules.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(m.id)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-colors',
                      selected.includes(m.id)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={create} className="w-full" disabled={creating || !name.trim()}>
              {creating ? (
                <>
                  <Spinner /> Provisioning…
                </>
              ) : (
                'Provision tenant'
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
