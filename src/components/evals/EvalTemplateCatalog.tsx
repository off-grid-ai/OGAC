'use client';

import { Lightning, Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EvalCatalogFilterBar } from '@/components/evals/EvalCatalogFilterBar';
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
import { Textarea } from '@/components/ui/textarea';
import {
  type CatalogSortKey,
  type CatalogTemplate,
  catalogFacets,
  filterTemplates,
  isFilterActive,
  sortTemplates,
} from '@/lib/eval-catalog-filter';

type Template = CatalogTemplate;

// 'engine' is a valid internal sort key but never exposed in the UI (sorting by it would surface
// the underlying evaluator engine name). Operators sort by name / category / threshold.
const SORT_KEYS: CatalogSortKey[] = ['name', 'category', 'threshold'];
function isSortKey(v: string | null): v is CatalogSortKey {
  return v !== null && (SORT_KEYS as string[]).includes(v);
}

const CATEGORY_LABEL: Record<string, string> = {
  rag: 'RAG — retrieval & grounding',
  safety: 'Safety & red-team',
  bias: 'Bias',
  privacy: 'Privacy',
  security: 'Security',
  quality: 'Quality',
  sentiment: 'Sentiment',
  conversational: 'Conversational (multi-turn chat)',
  agentic: 'Agentic (tools & tasks)',
  custom: 'Custom — write your own',
};

// Short labels for the filter chips (the full CATEGORY_LABEL is too long for a pill; shown as the
// chip's title tooltip). Unknown categories fall back to their raw id in the bar.
const CATEGORY_SHORT: Record<string, string> = {
  rag: 'RAG',
  safety: 'Safety',
  bias: 'Bias',
  privacy: 'Privacy',
  security: 'Security',
  quality: 'Quality',
  sentiment: 'Sentiment',
  conversational: 'Conversational',
  agentic: 'Agentic',
  custom: 'Custom',
};

// Show categories in a friendly, learnable order (not raw insertion order). Unknown categories fall
// to the end so nothing is ever hidden.
const CATEGORY_ORDER = [
  'rag',
  'quality',
  'safety',
  'security',
  'bias',
  'privacy',
  'conversational',
  'agentic',
  'sentiment',
  'custom',
];

// The HEADLINE surface: a browsable catalog of prebuilt evaluators. "Apply" turns a template into a
// saved eval definition in one click (name pre-filled). Availability is shown honestly — whether
// the check runs for real or via a degraded first-party fallback.
export function EvalTemplateCatalog({ onApplied }: { onApplied?: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<Template | null>(null);
  const [name, setName] = useState('');
  // G-Eval only: the operator's plain-English pass rule, stored as the def's description (the runner
  // uses it as the judge criteria). Empty for every other template.
  const [criteria, setCriteria] = useState('');
  const [saving, setSaving] = useState(false);

  // Search/filter/sort state lives in the URL so a filtered view is shareable and Back-coherent.
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get('tq') ?? '';
  const category = params.get('tcat') ?? '';
  const sortParam = params.get('tsort');
  const sortKey: CatalogSortKey = isSortKey(sortParam) ? sortParam : 'category';

  // Push one navigational param change (empty string clears the key). scroll:false keeps the catalog
  // in place as the operator narrows it.
  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const clearFilters = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    for (const k of ['tq', 'tcat', 'tsort']) next.delete(k);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const load = useCallback(async () => {
    const r = await fetch('/api/v1/admin/eval-templates');
    if (r.ok) setTemplates((await r.json()).data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openApply(t: Template) {
    setApplying(t);
    setName(t.name);
    setCriteria('');
  }

  const isGEval = applying?.metric === 'g_eval';

  async function apply() {
    if (!applying) return;
    setSaving(true);
    // For G-Eval the criteria IS the evaluator — pass it as the def description; the runner feeds it
    // to the gateway judge. For every other template the description defaults to the template's own.
    const body: Record<string, string> = {
      name: name.trim() || applying.name,
      templateId: applying.id,
    };
    if (applying.metric === 'g_eval' && criteria.trim()) body.description = criteria.trim();
    const r = await fetch('/api/v1/admin/eval-defs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (r.ok) {
      toast.success(`Added eval: ${name.trim() || applying.name}`);
      setApplying(null);
      onApplied?.();
    } else {
      const e = await r.json().catch(() => null);
      toast.error(e?.error ?? 'Could not add eval');
    }
  }

  // Engine filtering is intentionally never exposed in the UI (it would surface the underlying
  // evaluator engine name), so `engine` is fixed empty — operators filter by search + category.
  const filter = { q, category, engine: '' };
  const active = isFilterActive(filter);
  const facets = useMemo(() => catalogFacets(templates), [templates]);
  // Flat, sorted result when any filter is active; used for the count + flat grid.
  const filtered = useMemo(
    () => sortTemplates(filterTemplates(templates, filter), sortKey),
    [templates, q, category, sortKey],
  );

  const grouped = templates.reduce<Record<string, Template[]>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});
  const orderedCategories = Object.keys(grouped).sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  // One card renderer, reused by both the grouped and flat layouts.
  function renderCard(t: Template) {
    return (
      <div
        key={t.id}
        className="flex flex-col justify-between gap-2 rounded-md border border-border bg-muted/20 p-3"
      >
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium text-foreground">{t.name}</span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Apply ${t.name}`}
              className="h-6 shrink-0 px-2 text-xs"
              onClick={() => openApply(t)}
            >
              <Plus className="mr-1 size-3" />
              Apply
            </Button>
          </div>
          <p className="text-xs leading-snug text-muted-foreground">{t.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {t.availability.degraded ? (
            <Badge
              variant="secondary"
              className="bg-muted text-[10px] text-muted-foreground"
              title={t.availability.detail}
            >
              fallback
            </Badge>
          ) : t.availability.available ? (
            <Badge
              variant="secondary"
              className="bg-primary/10 text-[10px] text-primary"
              title={t.availability.detail}
            >
              ready
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] text-muted-foreground"
              title={t.availability.detail}
            >
              configure
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground">
            {t.direction === 'higher-better' ? '≥' : '≤'} {Math.round(t.defaultThreshold * 100)}%
          </span>
        </div>
      </div>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Lightning className="size-4 text-primary" />
          Evaluator templates
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Prebuilt evaluators — apply one to create an eval in a click. Each shows whether it runs
          for real or via a first-party fallback.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading templates…</p>
        ) : (
          <>
            <EvalCatalogFilterBar
              q={q}
              category={category}
              sortKey={sortKey}
              facets={facets}
              categoryLabel={CATEGORY_LABEL}
              categoryShort={CATEGORY_SHORT}
              active={active}
              resultCount={filtered.length}
              total={templates.length}
              onQ={(v) => setParam('tq', v)}
              onCategory={(v) => setParam('tcat', v)}
              onSort={(v) => setParam('tsort', v)}
              onClear={clearFilters}
            />

            {active ? (
              filtered.length === 0 ? (
                <div className="rounded-md border border-dashed border-border py-10 text-center">
                  <p className="text-sm text-foreground">No templates match your filters.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Try a different search term, or{' '}
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-primary underline underline-offset-2"
                    >
                      clear all filters
                    </button>.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filtered.map(renderCard)}
                </div>
              )
            ) : (
              orderedCategories.map((cat) => (
                <div key={cat} className="space-y-2">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {CATEGORY_LABEL[cat] ?? cat}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {grouped[cat].map(renderCard)}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </CardContent>

      {/* Apply dialog — name the eval, then it becomes a saved definition. */}
      <Sheet open={applying !== null} onOpenChange={(o) => !o && setApplying(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Apply template</SheetTitle>
            <SheetDescription>
              {applying?.name} — {applying?.method}
            </SheetDescription>
          </SheetHeader>
          {applying && (
            <SheetBody>
              <div className="space-y-1.5">
                <Label htmlFor="apply-name">Eval name</Label>
                <Input
                  id="apply-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={applying.name}
                />
              </div>
              {isGEval && (
                <div className="space-y-1.5">
                  <Label htmlFor="apply-criteria">What should a good answer do? (plain English)</Label>
                  <Textarea
                    id="apply-criteria"
                    value={criteria}
                    onChange={(e) => setCriteria(e.target.value)}
                    rows={4}
                    placeholder="e.g. Does the answer cite a policy document and stay under 200 words?"
                  />
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    An AI judge reads this rule and scores every answer against it — 0 to 100%. Write it
                    the way you’d explain it to a colleague. Needs a gateway judge configured; without one
                    the eval runs but honestly reports “no score”.
                  </p>
                </div>
              )}
              <div className="space-y-1 rounded-md border border-border bg-muted/20 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Checks for</span>
                  <span className="font-medium">{applying.metric}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pass threshold</span>
                  <span>
                    {applying.direction === 'higher-better' ? '≥' : '≤'}{' '}
                    {Math.round(applying.defaultThreshold * 100)}%
                  </span>
                </div>
                <p className="pt-1 text-muted-foreground">{applying.availability.detail}</p>
              </div>
            </SheetBody>
          )}
          <SheetFooter>
            <Button variant="ghost" onClick={() => setApplying(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={saving || (isGEval && !criteria.trim())}>
              {saving ? 'Adding…' : 'Add eval'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
