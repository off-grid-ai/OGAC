import { ANALYTICS_INTEGRATIONS } from '@offgrid/analytics';
import { FINOPS_INTEGRATIONS } from '@offgrid/finops';
import { POLICY_INTEGRATIONS } from '@offgrid/policy';
import { VECTORDB_INTEGRATIONS } from '@offgrid/vectordb';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// The gateway platform's plug-and-play integration catalog — the composable layers
// (policy/guardrails, analytics, finops, vector DB) each publish an *_INTEGRATIONS
// list; we render them here so the directory reflects "what can plug in" alongside
// the connectors. Config fields hint at what each needs (a URL, an API key, …).
interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  configFields?: readonly string[];
  description?: string;
  status?: string;
}

const GROUPS: { title: string; note: string; items: readonly CatalogEntry[] }[] = [
  { title: 'Policy & guardrails', note: 'PII / rate limits / budgets / cache', items: POLICY_INTEGRATIONS as CatalogEntry[] },
  { title: 'Analytics', note: 'usage + event sinks', items: ANALYTICS_INTEGRATIONS as CatalogEntry[] },
  { title: 'FinOps', note: 'cost + budget tracking', items: FINOPS_INTEGRATIONS as CatalogEntry[] },
  { title: 'Vector DB / knowledge', note: 'connect + inspect', items: VECTORDB_INTEGRATIONS as CatalogEntry[] },
];

function statusBadge(status?: string): { text: string; cls: string } {
  if (status === 'planned') return { text: 'planned', cls: 'bg-muted text-muted-foreground' };
  return { text: 'available', cls: 'bg-primary/10 text-primary' };
}

export function GatewayIntegrations() {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Gateway integrations</CardTitle>
        <p className="text-xs text-muted-foreground">
          Plug-and-play layers on the gateway. Configure each with its URL / key; the hard,
          maintained work (managed connectors, ETL, fleet) is the Pro tier.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-foreground">{g.title}</h3>
              <span className="text-[11px] text-muted-foreground">{g.note}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-4">
              {g.items.map((it) => {
                const s = statusBadge(it.status);
                return (
                  <div key={g.title + it.id} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{it.name}</span>
                      <Badge variant="secondary" className={`shrink-0 ${s.cls}`}>{s.text}</Badge>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{it.category}</div>
                    {it.description ? (
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{it.description}</p>
                    ) : null}
                    {it.configFields?.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {it.configFields.map((f) => (
                          <span key={f} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {f}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
