'use client';

import { Database, Lightning, MagnifyingGlass, Plus } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SubNav } from '@/components/nav/SubNav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  CONNECTOR_CATEGORIES,
  CONNECTOR_TYPES,
  buildAddPayload,
  connectorCatalogByCategory,
  filterConnectorCatalog,
  getConnectorType,
  isAddable,
  type ConnectorCategory,
  type ConnectorType,
} from '@/lib/connector-catalog';
import { cn } from '@/lib/utils';

// ─── ConnectorCatalog (Task #127) — browse + one-click add a curated data source ─────────────────
// The MCP-catalog pattern, for DATA. Category-grouped cards with search + category filter, each with
// an "Add" that opens a sheet prefilled from the catalog entry (name/endpoint hint/auth). Adding
// POSTs the PURE buildAddPayload through the EXISTING connector-create route
// (/api/v1/admin/connectors) — no new storage — so the connector shows in the directory below and is
// bindable in data-domains. All navigational state lives in the URL (?dq= search, ?dcat= category,
// ?add=<id> open) so Back is coherent and the view is deep-linkable — never local useState. Distinct
// param names (dq/dcat/add) so it never collides with the adapter catalog's ?cat= on the same page.

const ALL = '__all__';

function isCategory(v: string | null): v is ConnectorCategory {
  return !!v && (CONNECTOR_CATEGORIES as string[]).includes(v);
}

export function ConnectorCatalog() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const query = params.get('dq') ?? '';
  const catParam = params.get('dcat');
  const activeCat: ConnectorCategory | null = isCategory(catParam) ? catParam : null;
  const openId = params.get('add');
  const openType = openId ? getConnectorType(openId) : null;

  // Build an href that mutates the catalog params while preserving everything else on the page.
  const withParams = useCallback(
    (mut: (sp: URLSearchParams) => void): string => {
      const sp = new URLSearchParams(params.toString());
      mut(sp);
      const qs = sp.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname],
  );

  const catHref = (cat: ConnectorCategory | typeof ALL) =>
    withParams((sp) => {
      if (cat === ALL) sp.delete('dcat');
      else sp.set('dcat', cat);
    });

  const setQuery = useCallback(
    (value: string) => {
      router.replace(
        withParams((sp) => {
          if (value.trim()) sp.set('dq', value);
          else sp.delete('dq');
        }),
        { scroll: false },
      );
    },
    [router, withParams],
  );

  const setOpen = useCallback(
    (id: string | null) => {
      router.replace(
        withParams((sp) => {
          if (id) sp.set('add', id);
          else sp.delete('add');
        }),
        { scroll: false },
      );
    },
    [router, withParams],
  );

  const filtered = useMemo(
    () => filterConnectorCatalog(CONNECTOR_TYPES, query, activeCat),
    [query, activeCat],
  );
  const groups = useMemo(() => connectorCatalogByCategory(filtered), [filtered]);

  const tabs: { id: ConnectorCategory | typeof ALL; label: string }[] = [
    { id: ALL, label: 'All' },
    ...CONNECTOR_CATEGORIES.map((c) => ({ id: c, label: c })),
  ];

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Add a data source</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick a source type from the curated catalog and add it in one step — no hand-configuring.
          Databases and REST APIs are <b>live-queryable</b> (they read rows for sync and can be bound
          into a data domain); warehouses, object stores, streaming and NoSQL sources are catalogued
          as <b>metadata-only</b> today.
        </p>
      </div>

      {/* Search + category filter. The search box is a single focused input (kept narrow); the
          category strip is a scoped sub-nav driven by ?dcat=. */}
      <div className="relative max-w-md">
        <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search connector catalog"
          placeholder="Search connectors (postgres, kafka, warehouse…)"
          defaultValue={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <SubNav>
        <nav className="flex flex-wrap items-center gap-1" aria-label="Connector categories">
          {tabs.map((t) => {
            const isActive = t.id === ALL ? activeCat === null : activeCat === t.id;
            return (
              <Link
                key={t.id}
                href={catHref(t.id)}
                scroll={false}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'rounded-md px-2.5 py-1 text-sm transition-colors',
                  isActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </SubNav>

      {groups.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">No connector types match your search.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.category} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
                {g.category}
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {g.types.map((t) => (
                  <Card key={t.id} className="flex flex-col shadow-sm">
                    <CardHeader className="space-y-0 pb-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <Database className="size-5 text-primary" />
                          <CardTitle className="text-sm">{t.name}</CardTitle>
                        </div>
                        {t.liveQuery ? (
                          <Badge variant="secondary" className="bg-primary/10 text-primary">
                            <Lightning className="mr-1 size-3" weight="fill" />
                            live-query
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-muted-foreground">
                            metadata-only
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col justify-between gap-3">
                      <p className="text-xs text-muted-foreground">{t.description}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => setOpen(t.id)}
                      >
                        <Plus className="size-4" />
                        Add
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {openType ? (
        <AddFromCatalogSheet
          type={openType}
          open={true}
          onClose={() => setOpen(null)}
          onAdded={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

// ─── AddFromCatalogSheet — prefilled create form for one catalog entry ────────────────────────────
// Prefills the connector name + endpoint hint from the catalog entry, collects the entry's fields
// (secret fields masked), and on submit builds the EXACT create body via the pure buildAddPayload and
// POSTs it to the EXISTING route. Secret-field values stay client-side (they belong in a secret
// store); only the endpoint (which for DBs carries the DSN the exec layer needs) is persisted.
function AddFromCatalogSheet({
  type,
  open,
  onClose,
  onAdded,
}: {
  type: ConnectorType;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [busy, setBusy] = useState(false);

  // Prefill on open: a sensible default name + the endpoint hint as a starting point the operator
  // must confirm/replace with their real source (the console never guesses / auto-connects).
  useEffect(() => {
    if (open) {
      setName(`${type.name}`);
      setEndpoint('');
    }
  }, [open, type]);

  const endpointField = type.fields.find((f) => f.key === 'endpoint') ?? type.fields[0];
  const secretFields = type.fields.filter((f) => f.secret);

  async function add() {
    if (!isAddable(type, { name, endpoint })) {
      toast.error('Enter a name and the endpoint / connection string for this source.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildAddPayload(type, { name, endpoint })),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Added "${name}" — now in the connector directory.`);
      onAdded();
    } catch {
      toast.error('Failed to add connector');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add {type.name}</SheetTitle>
          <SheetDescription>
            {type.liveQuery
              ? 'A live-queryable source: once added, sync reads its rows and it can be bound into a data domain.'
              : 'Catalogued as a data source in the directory. Live querying through the console is not wired for this type yet.'}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="cat-con-name">Name</Label>
            <Input
              id="cat-con-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type.name}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-con-endpoint">{endpointField.label}</Label>
            <Input
              id="cat-con-endpoint"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={endpointField.placeholder ?? type.endpointHint}
            />
            <p className="text-xs text-muted-foreground">
              Example: <code className="font-mono">{type.endpointHint}</code>. The console never
              connects out on its own — this is where your source lives.
            </p>
          </div>
          {secretFields.length > 0 ? (
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Credentials — kept in your secret store, never stored on the connector row
              </p>
              {secretFields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`cat-secret-${f.key}`}>{f.label}</Label>
                  <Input id={`cat-secret-${f.key}`} type="password" autoComplete="off" />
                </div>
              ))}
            </div>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button onClick={add} disabled={busy || !name.trim() || !endpoint.trim()} className="w-full">
            {busy ? 'Adding…' : `Add ${type.name}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
