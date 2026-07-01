import { AbacTester } from '@/components/admin/AbacTester';
import { AddAbacRuleButton } from '@/components/admin/AddAbacRuleButton';
import { AddCustomRoleButton } from '@/components/admin/AddCustomRoleButton';
import { AddTenantButton } from '@/components/admin/AddTenantButton';
import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
import { FlagToggle } from '@/components/admin/FlagToggle';
import { OrgInstructionsEditor } from '@/components/admin/OrgInstructionsEditor';
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
import { listBindings } from '@/lib/adapters/registry';
import { requireModuleForUser } from '@/lib/module-access';
import {
  getOrgSystemPrompt,
  listAbacRules,
  listCustomRoles,
  listFlags,
  listTenants,
} from '@/lib/store';
import { MODULES } from '@/modules/registry';

export const dynamic = 'force-dynamic';

const EFFECT: Record<string, string> = {
  allow: 'bg-primary/10 text-primary',
  deny: 'bg-destructive/10 text-destructive',
};

const RENDER: Record<string, string> = {
  native: 'bg-primary/10 text-primary',
  embed: 'bg-blue-500/10 text-blue-600',
  headless: 'bg-muted text-muted-foreground',
};

function labelOf(id: string): string {
  return MODULES.find((m) => m.id === id)?.label ?? id;
}

export default async function AdminPage() {
  await requireModuleForUser('admin');
  const [tenants, rules, bindings, flags, orgPrompt, customRoles] = await Promise.all([
    listTenants(),
    listAbacRules(),
    listBindings(true),
    listFlags(),
    getOrgSystemPrompt(),
    listCustomRoles(),
  ]);
  const sellable = MODULES.filter((m) => !m.internal).map((m) => ({ id: m.id, label: m.label }));

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Org-wide instructions</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            The organization system prompt — injected into every chat as the highest-precedence
            system block, ahead of each user&apos;s own custom instructions.
          </p>
        </CardHeader>
        <CardContent>
          <OrgInstructionsEditor initial={orgPrompt} />
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm">Custom roles</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Roles layered on the built-in RBAC/ABAC — each inherits a base role and grants module
              access. SCIM group sync maps onto these (stub).
            </p>
          </div>
          <AddCustomRoleButton modules={sellable} />
        </CardHeader>
        <CardContent>
          {customRoles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custom roles yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Inherits</TableHead>
                  <TableHead>Module access</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {customRoles.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-foreground">{r.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.basedOn}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.capabilities.length === 0 ? (
                          <span className="text-xs text-muted-foreground">none</span>
                        ) : (
                          r.capabilities.map((id) => (
                            <Badge
                              key={id}
                              variant="secondary"
                              className="bg-primary/10 text-primary"
                            >
                              {labelOf(id)}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DeleteRowButton url={`/api/v1/admin/roles/${r.id}`} label={r.name} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Integrations · adapters</CardTitle>
          <p className="text-xs text-muted-foreground">
            Every underlying tool is reached through a capability port — swap it with one env var,
            no code change. Set <code>OFFGRID_ADAPTER_&lt;CAPABILITY&gt;</code> to an adapter id.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Capability</TableHead>
                <TableHead>Active adapter</TableHead>
                <TableHead>License</TableHead>
                <TableHead>UI</TableHead>
                <TableHead>Swappable for</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bindings.map((b) => (
                <TableRow key={b.capability}>
                  <TableCell className="font-medium text-foreground">{b.capability}</TableCell>
                  <TableCell className="text-foreground">
                    {b.active.vendor}
                    {b.healthy === false ? (
                      <Badge variant="secondary" className="ml-2 bg-amber-500/10 text-amber-600">
                        unreachable
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{b.active.license}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={RENDER[b.active.render]}>
                      {b.active.render}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.alternatives.length === 0 ? (
                      '—'
                    ) : (
                      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        {b.alternatives.map((a) => (
                          <span key={a.id} className="whitespace-nowrap">
                            {a.vendor}
                            {a.status === 'planned' ? (
                              <Badge
                                variant="secondary"
                                className="ml-1 bg-muted text-muted-foreground"
                              >
                                planned
                              </Badge>
                            ) : null}
                          </span>
                        ))}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Feature flags</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Runtime toggles for capabilities/features (the first-party flag store; Unleash backs it
            at scale). Flip without a redeploy.
          </p>
        </CardHeader>
        <CardContent>
          {flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No flags yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Flag</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-16">On</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flags.map((f) => (
                  <TableRow key={f.key}>
                    <TableCell className="font-mono text-xs text-foreground">{f.key}</TableCell>
                    <TableCell className="text-muted-foreground">{f.description || '—'}</TableCell>
                    <TableCell>
                      <FlagToggle flagKey={f.key} enabled={f.enabled} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Tenants &amp; provisioning</CardTitle>
          <AddTenantButton modules={sellable} />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Provisioned planes</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium text-foreground">{t.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t.plan}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {t.enabledModules.length === 0 ? (
                        <span className="text-xs text-muted-foreground">none</span>
                      ) : (
                        t.enabledModules.map((id) => (
                          <Badge
                            key={id}
                            variant="secondary"
                            className="bg-primary/10 text-primary"
                          >
                            {labelOf(id)}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DeleteRowButton url={`/api/v1/admin/tenants/${t.id}`} label={t.name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">ABAC policy</CardTitle>
          <AddAbacRuleButton />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Effect</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground">{r.role}</TableCell>
                  <TableCell className="text-foreground">{r.resource}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.attribute} {r.operator} {r.value}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={EFFECT[r.effect]}>
                      {r.effect}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DeleteRowButton url={`/api/v1/admin/abac-rules/${r.id}`} label="rule" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mb-4 mt-4 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Deny overrides allow · test a decision below
          </p>
          <AbacTester />
        </CardContent>
      </Card>
    </div>
  );
}
