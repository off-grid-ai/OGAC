import { ShieldCheck } from '@phosphor-icons/react/dist/ssr';
import { GuardrailCatalog } from '@/components/guardrails/GuardrailCatalog';
import { GuardrailRules } from '@/components/guardrails/GuardrailRules';
import { PresidioRecognizers } from '@/components/guardrails/PresidioRecognizers';
import { PresidioThresholds } from '@/components/guardrails/PresidioThresholds';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPii } from '@/lib/adapters/registry';
import { listGuardrailRules } from '@/lib/guardrails-rules';
import { readGuardrailsView } from '@/lib/guardrails-view';
import { requireModuleForUser } from '@/lib/module-access';
import { listPipelines } from '@/lib/pipelines';
import { getThresholds, listRecognizers } from '@/lib/presidio-recognizers';
import { currentOrgId } from '@/lib/tenancy';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// Guardrails / PII surface read-back. Server component: reads the active guardrails engine +
// reachability + supported entity types through the pure view. Gated on the `control` module
// (guardrails / egress policy / audit live there). The "test a string" box runs the input through
// the LIVE active adapter (Presidio detect + anonymize when configured, regex floor otherwise) so
// it shows what actually happens — not just the regex demo. URL-driven (?q=...), no client state.
export default async function GuardrailsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ q?: string }>;
}>) {
  await requireModuleForUser('guardrails');
  const { q } = await searchParams;
  const probe = typeof q === 'string' ? q : '';
  const view = probe
    ? await readGuardrailsView(await getPii().scan(probe), probe)
    : await readGuardrailsView();
  const orgId = await currentOrgId();
  // Degrade gracefully (consistent with the DEEP-layer .catch below): DB down → no rules, page renders.
  const rules = await listGuardrailRules(orgId).catch(() => []);
  // The DEEP layer — best-effort so a missing DB never breaks the page.
  const [recognizers, thresholds, pipelines] = await Promise.all([
    listRecognizers(orgId).catch(() => []),
    getThresholds(orgId).catch(() => ({ global: 0, perEntity: {} })),
    listPipelines(orgId).catch(() => []),
  ]);

  // Honest engine status for the catalog's per-item availability badges. LLM Guard is THE
  // authoritative content-guardrail engine: PII entities + scanners are "ready" once LLM Guard is the
  // active, configured, reachable engine. No Guardrails-AI runtime is wired yet, so the legacy
  // second-opinion validators are stored intent.
  const llmGuardReady = view.engine === 'llm-guard' && view.configured && view.reachable;
  const engineStatus = {
    guardrailsAiReady: false,
    llmGuardReady,
  };

  return (
    <PageFrame>
      {
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <ShieldCheck className="size-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Guardrails</h1>
              <p className="text-sm text-muted-foreground">
                Input/output PII policy — the active detector, its reachability, and the entity
                types it surfaces. Detection falls back to the always-on baseline pattern protection
                if the detector is down.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  PII detection
                  <Badge variant={view.reachable ? 'default' : 'destructive'}>
                    {view.reachable ? 'reachable' : 'unreachable'}
                  </Badge>
                  {view.engine === 'presidio' && !view.configured ? (
                    <Badge variant="secondary">not configured</Badge>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                <p>
                  Detection:{' '}
                  <span className="text-foreground">
                    {view.engine === 'presidio'
                      ? 'Entity-grade PII detection'
                      : 'Built-in pattern detection'}
                  </span>
                </p>
                {view.engine === 'presidio' ? (
                  <p className="text-xs">
                    Falls back to the always-on pattern detector when the detection service is down.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Supported entity types</CardTitle>
                <Badge variant="secondary" className="bg-primary/10 text-primary">
                  {view.entityTypes.length}
                </Badge>
              </CardHeader>
              <CardContent>
                {view.entityTypes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No entity types reported yet — the always-on baseline pattern protection still
                    applies.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {view.entityTypes.map((t) => (
                      <Badge
                        key={t}
                        variant="outline"
                        className="font-mono text-xs text-muted-foreground"
                      >
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Turn on standard protections</CardTitle>
            </CardHeader>
            <CardContent>
              <GuardrailCatalog
                engineStatus={engineStatus}
                enabledRules={rules.map((r) => ({ matcher: r.matcher, pattern: r.pattern }))}
                pipelines={pipelines.map((p) => ({
                  id: p.id,
                  name: p.name,
                  guardrailOverlay: p.guardrailOverlay,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Masking rules</CardTitle>
            </CardHeader>
            <CardContent>
              <GuardrailRules rules={rules} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Custom recognizers &amp; deny lists</CardTitle>
            </CardHeader>
            <CardContent>
              <PresidioRecognizers recognizers={recognizers} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Confidence thresholds</CardTitle>
            </CardHeader>
            <CardContent>
              <PresidioThresholds thresholds={thresholds} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Test a string</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <form method="GET" className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  name="q"
                  defaultValue={probe}
                  placeholder="e.g. email me at jane@acme.com or call +1 202 555 0143"
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Scan
                </button>
              </form>
              <p className="text-xs text-muted-foreground">
                Runs the LIVE active engine — when entity-grade detection is on, your custom
                recognizers, deny lists, and thresholds all apply, so you see exactly what a real
                request would. Read-only, nothing is stored.
              </p>
              {view.demo ? (
                <div className="space-y-1 rounded-md border border-border p-3">
                  <p>
                    Result:{' '}
                    <Badge variant={view.demo.hits ? 'destructive' : 'default'}>
                      {view.demo.hits ? 'PII detected' : 'no PII'}
                    </Badge>{' '}
                    <span className="text-muted-foreground">
                      via{' '}
                      {view.demo.engine === 'presidio'
                        ? 'entity-grade detection'
                        : 'pattern detector'}
                    </span>
                  </p>
                  {view.demo.entities.length ? (
                    <p className="font-mono text-xs text-foreground">
                      {view.demo.entities.join(', ')}
                    </p>
                  ) : null}
                  {view.demo.redacted ? (
                    <p className="font-mono text-xs text-muted-foreground">{view.demo.redacted}</p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      }
    </PageFrame>
  );
}
