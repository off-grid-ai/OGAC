'use client';

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
import type { OpaBundleView } from '@/lib/adapters/opa-audit';

// Read-only bundles + activation view. Honest by construction: when no remote bundle is configured
// and the status plugin is off (the current on-prem deployment), it says so plainly and shows the
// loaded Rego modules as the real active policy set — never a fabricated bundle/revision.
export function PolicyAuditBundles({ view }: Readonly<{ view: OpaBundleView }>) {
  if (!view.configured) {
    return (
      <div className="w-full rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        The policy engine is not reachable{view.reason ? ` (${view.reason})` : ''}. Connect it in
        Settings to inspect policy bundles and activation status. The first-party engine keeps
        serving decisions in the meantime.
      </div>
    );
  }

  const cfg = view.config;
  const status = view.status;

  return (
    <div className="grid w-full gap-4 lg:grid-cols-2">
      {/* engine config */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Engine configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="OPA version" value={cfg?.labels.version || '—'} mono />
          <Row label="Node id" value={cfg?.labels.id || '—'} mono />
          <Row label="Default decision" value={cfg?.defaultDecision || '—'} mono />
          <Row
            label="Decision-log stream"
            value={
              cfg?.decisionLogsConfigured ? (
                <Badge>{cfg.decisionLogService || 'configured'}</Badge>
              ) : (
                <span className="text-muted-foreground">not configured</span>
              )
            }
          />
        </CardContent>
      </Card>

      {/* activation status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            Bundle activation
            {status ? (
              <Badge variant={status.statusPluginEnabled ? 'default' : 'secondary'}>
                {status.statusPluginEnabled ? 'status plugin on' : 'status plugin off'}
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {status?.statusPluginEnabled && status.activations.length ? (
            <div className="space-y-2">
              {status.activations.map((a) => (
                <div key={a.name} className="rounded-md border p-2">
                  <div className="font-mono text-sm">{a.name}</div>
                  <div className="text-xs text-muted-foreground">
                    revision <span className="font-mono">{a.activeRevision || '—'}</span>
                    {a.code ? <span className="ml-2 text-destructive">{a.code}: {a.message}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">
              No remote bundle activation reported. On this deployment policy is loaded via the
              policy API (see the active modules below), not a signed remote bundle, so activation is
              deploy-owned.
            </p>
          )}
        </CardContent>
      </Card>

      {/* configured remote bundles */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">Configured bundles</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {cfg && cfg.bundles.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Polling</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cfg.bundles.map((b) => (
                    <TableRow key={b.name}>
                      <TableCell className="font-mono">{b.name}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{b.service || '—'}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{b.resource || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={b.polling ? 'default' : 'secondary'}>
                          {b.polling ? 'polling' : 'static'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="p-6 text-sm text-muted-foreground">
              No remote bundles configured. Policy is loaded via the policy API.
            </p>
          )}
        </CardContent>
      </Card>

      {/* loaded Rego modules — the honest active policy set */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">Active policy modules</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {view.policies.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Module id</TableHead>
                    <TableHead>Package</TableHead>
                    <TableHead className="text-right">Rules</TableHead>
                    <TableHead className="text-right">Source bytes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.policies.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono">{p.id}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{p.package || '—'}</TableCell>
                      <TableCell className="text-right font-mono">{p.ruleCount}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{p.sourceBytes}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="p-6 text-sm text-muted-foreground">No policy modules loaded.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: Readonly<{ label: string; value: React.ReactNode; mono?: boolean }>) {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={mono ? 'break-all font-mono text-xs' : ''}>{value}</span>
    </div>
  );
}
