import { Scales } from '@phosphor-icons/react/dist/ssr';
import { Suspense } from 'react';
import { PolicyRulesManager } from '@/components/policy/PolicyRulesManager';
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
import { requireModuleForUser } from '@/lib/module-access';
import { listPolicyRules } from '@/lib/policy-rules';
import { readDecisions, readPolicyStatus } from '@/lib/policy-view';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Policy management + decisions read-back. Server component: reads the active policy set + OPA
// reachability, the console-owned policy rules, and the normalized recent decisions through the pure
// views. The rules table (add/edit/delete + push-to-OPA) is a client child; its nav lives in the URL.
export default async function PolicyPage() {
  await requireModuleForUser('policy');
  const orgId = await currentOrgId();
  const [status, decisions, rules] = await Promise.all([
    readPolicyStatus(),
    readDecisions(),
    listPolicyRules(orgId),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Scales className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Policy</h1>
          <p className="text-sm text-muted-foreground">
            Policy-as-code decisions — the active policy set, engine reachability, and recent
            allow/deny evaluations.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Engine
            <Badge variant={status.reachable ? 'default' : 'destructive'}>
              {status.reachable ? 'reachable' : 'unreachable'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>
            Active engine: <span className="font-mono text-foreground">{status.engine}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active policy set</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Adapter</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>License</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.policies.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono">
                    {p.id}
                    {p.id === status.engine ? (
                      <Badge variant="secondary" className="ml-2">
                        active
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{p.vendor}</TableCell>
                  <TableCell className="text-muted-foreground">{p.license}</TableCell>
                  <TableCell className="text-muted-foreground">{p.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Policy rules</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading rules…</p>}>
            <PolicyRulesManager rules={rules} />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent decisions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {decisions.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No decision-log records. Configure{' '}
              <span className="font-mono">OFFGRID_OPA_DECISION_LOG_URL</span> to stream OPA
              decisions here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Decision</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Input</TableHead>
                  <TableHead>Engine</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decisions.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Badge variant={d.allow ? 'default' : 'destructive'}>{d.decision}</Badge>
                    </TableCell>
                    <TableCell className="font-mono">{d.path || '—'}</TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">
                      {d.input}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">{d.engine}</TableCell>
                    <TableCell className="text-muted-foreground">{d.timestamp || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
