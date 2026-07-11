import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
import { AddRoutingRuleButton } from '@/components/control/AddRoutingRuleButton';
import { AuditSearch } from '@/components/control/AuditSearch';
import { PolicyEditor } from '@/components/control/PolicyEditor';
import { RoutingRuleToggle } from '@/components/control/RoutingRuleToggle';
import { RoutingTester } from '@/components/control/RoutingTester';
import { SecretsPanel } from '@/components/control/SecretsPanel';
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
import { db } from '@/db';
import { fleetNodes } from '@/db/schema';
import { openBaoConfigured, openBaoSecrets } from '@/lib/adapters/secrets';
import { fleetModelTags } from '@/lib/model-catalog';
import { requireModuleForUser } from '@/lib/module-access';
import { modelOptions } from '@/lib/policy-catalog';
import { siemConfigured } from '@/lib/siem';
import {
  getOrgPolicy,
  listAudit,
  listPolicyHistory,
  listRoutingRules,
  listUsers,
} from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

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
  await requireModuleForUser('control');
  const org = await currentOrgId();
  const [policy, history, users, events, routes] = await Promise.all([
    getOrgPolicy(),
    listPolicyHistory(),
    listUsers(org),
    listAudit({ limit: 25, orgId: org }),
    listRoutingRules(org),
  ]);
  const baoReady = openBaoConfigured();
  const secretKeys = baoReady && openBaoSecrets.list ? await openBaoSecrets.list() : [];

  // The live fleet routing tags feed the PolicyEditor's constrained model picker (catalog ∪ served).
  // Degrade gracefully: DB down → catalog-only options, page still renders.
  const nodes = await db
    .select({ model: fleetNodes.model, role: fleetNodes.role })
    .from(fleetNodes)
    .catch(() => [] as { model: string; role: string }[]);
  const liveModelTags = fleetModelTags(nodes);
  const pickableModels = modelOptions(liveModelTags);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PolicyEditor
          initial={policy}
          modelOptions={pickableModels}
          fleetModelTags={liveModelTags}
        />

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
              For each request, the first matching rule (lowest priority number) decides where it
              runs. No rule matches → runs locally.
            </p>
          </div>
          <AddRoutingRuleButton />
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Plain-language legend + the live egress state, so the leash is clear in context. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5">
              <Badge variant="secondary" className="bg-primary/10 text-primary">local</Badge>
              <span className="text-muted-foreground">on-prem model, data stays on the box</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Badge variant="secondary" className="bg-blue-500/10 text-blue-600">cloud</Badge>
              <span className="text-muted-foreground">external model — only if egress is ON</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Badge variant="secondary" className="bg-destructive/10 text-destructive">block</Badge>
              <span className="text-muted-foreground">request refused</span>
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <span className="text-muted-foreground">Cloud egress:</span>
              <Badge
                variant="secondary"
                className={
                  policy.egressAllowed
                    ? 'bg-blue-500/10 text-blue-600'
                    : 'bg-primary/10 text-primary'
                }
              >
                {policy.egressAllowed ? 'ON' : 'OFF — cloud rules forced to block'}
              </Badge>
            </span>
          </div>
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
          <CardTitle className="text-sm">Secrets vault</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Connector/tool credentials and virtual-key secrets stored in the secrets store (KV v2)
            via the secrets adapter. Values are write-only from here — only key names are listed back.
          </p>
        </CardHeader>
        <CardContent>
          <SecretsPanel configured={baoReady} initialKeys={secretKeys} />
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Audit search (SIEM)</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Full-text + filtered search over the audit stream shipped to OpenSearch — beyond the
            recent slice below.
          </p>
        </CardHeader>
        <CardContent>
          <AuditSearch configured={siemConfigured()} />
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
