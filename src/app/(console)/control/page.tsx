import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
import { AddRoutingRuleButton } from '@/components/control/AddRoutingRuleButton';
import { PolicyEditor } from '@/components/control/PolicyEditor';
import { RoutingRuleToggle } from '@/components/control/RoutingRuleToggle';
import { RoutingTester } from '@/components/control/RoutingTester';
import { UsersTable } from '@/components/control/UsersTable';
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
import { requireModule } from '@/lib/modules';
import {
  getOrgPolicy,
  listAudit,
  listPolicyHistory,
  listRoutingRules,
  listUsers,
} from '@/lib/store';

export const dynamic = 'force-dynamic';

const OUTCOME_VARIANT: Record<string, string> = {
  ok: 'text-muted-foreground',
  redacted: 'bg-primary/10 text-primary',
  blocked: 'bg-destructive/10 text-destructive',
};

const CHECK_VARIANT: Record<string, string> = {
  pass: 'text-muted-foreground',
  warn: 'bg-amber-500/10 text-amber-600',
  redacted: 'bg-primary/10 text-primary',
  blocked: 'bg-destructive/10 text-destructive',
  fail: 'bg-destructive/10 text-destructive',
};

export default async function ControlPage() {
  requireModule('control');
  const [policy, history, users, events, routes] = await Promise.all([
    getOrgPolicy(),
    listPolicyHistory(),
    listUsers(),
    listAudit({ limit: 25 }),
    listRoutingRules(),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PolicyEditor initial={policy} />

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Policy history</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Egress</TableHead>
                  <TableHead>Guardrails</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((p) => (
                  <TableRow key={p.version}>
                    <TableCell className="font-medium text-foreground">v{p.version}</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={p.egressAllowed ? 'bg-primary/10 text-primary' : ''}
                      >
                        {p.egressAllowed ? 'allowed' : 'blocked'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.guardrails.length}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {p.updatedAt.slice(0, 10)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm">Model routing</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Conditional + smart routing. First matching rule (by priority) decides where a request
              runs; cloud is leashed by the egress switch above.
            </p>
          </div>
          <AddRoutingRuleButton />
        </CardHeader>
        <CardContent className="space-y-4">
          <RoutingTester />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Model · fallback</TableHead>
                <TableHead className="w-16">On</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {routes.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground">{r.priority}</TableCell>
                  <TableCell className="font-medium text-foreground">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.attribute} {r.operator} {r.value}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        r.action === 'cloud'
                          ? 'bg-blue-500/10 text-blue-600'
                          : r.action === 'block'
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-primary/10 text-primary'
                      }
                    >
                      {r.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.model || '—'}
                    {r.fallback ? ` · ${r.fallback}` : ''}
                  </TableCell>
                  <TableCell>
                    <RoutingRuleToggle id={r.id} enabled={r.enabled} />
                  </TableCell>
                  <TableCell>
                    <DeleteRowButton url={`/api/v1/admin/routing/${r.id}`} label={r.name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Users &amp; roles (RBAC)</CardTitle>
        </CardHeader>
        <CardContent>
          <UsersTable users={users} />
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Audit log</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead>Left device</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Checks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-muted-foreground">{e.ts.slice(11, 19)}</TableCell>
                  <TableCell className="text-muted-foreground">{e.deviceId}</TableCell>
                  <TableCell className="font-medium text-foreground">{e.model}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{e.tokens}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.leftDevice ? 'yes' : 'no'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={OUTCOME_VARIANT[e.outcome]}>
                      {e.outcome}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(e.checks ?? []).map((c) => (
                        <Badge
                          key={c.name}
                          variant="secondary"
                          className={CHECK_VARIANT[c.verdict] ?? ''}
                        >
                          {c.name}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
