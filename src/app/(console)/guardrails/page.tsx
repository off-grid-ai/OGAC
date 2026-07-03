import { ShieldCheck } from '@phosphor-icons/react/dist/ssr';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { demoScan, readGuardrailsView } from '@/lib/guardrails-view';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Guardrails / PII surface read-back. Server component: reads the active guardrails engine +
// reachability + supported entity types through the pure view. Gated on the `control` module
// (guardrails / egress policy / audit live there). The "test a string" demo is URL-driven
// (?q=...) so it runs the regex floor with no client state — nav is URL/history only.
export default async function GuardrailsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireModuleForUser('control');
  const { q } = await searchParams;
  const probe = typeof q === 'string' ? q : '';
  const view = probe
    ? await readGuardrailsView(demoScan(probe), probe)
    : await readGuardrailsView();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ShieldCheck className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Guardrails</h1>
          <p className="text-sm text-muted-foreground">
            Input/output PII policy — the active detection engine, its reachability, and the entity
            types it surfaces. Detection degrades to the always-on regex floor if the engine is down.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Engine
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
            Active engine: <span className="font-mono text-foreground">{view.engine}</span>{' '}
            <span className="text-muted-foreground">({view.vendor})</span>
          </p>
          <p>
            License: <span className="font-mono text-foreground">{view.license}</span>
          </p>
          {view.description ? <p>{view.description}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Supported entity types</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entity type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.entityTypes.map((t) => (
                <TableRow key={t}>
                  <TableCell className="font-mono">{t}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
            Runs the always-on first-party regex floor in-console — read-only, nothing is stored.
          </p>
          {view.demo ? (
            <div className="space-y-1 rounded-md border border-border p-3">
              <p>
                Result:{' '}
                <Badge variant={view.demo.hits ? 'destructive' : 'default'}>
                  {view.demo.hits ? 'PII detected' : 'no PII'}
                </Badge>{' '}
                <span className="text-muted-foreground">via {view.demo.engine}</span>
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
  );
}
