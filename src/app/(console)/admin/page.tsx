import { AddAbacRuleButton } from '@/components/admin/AddAbacRuleButton';
import { AddTenantButton } from '@/components/admin/AddTenantButton';
import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
import { EmbedFrame } from '@/components/admin/EmbedFrame';
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
import { listBindings, listEmbeds } from '@/lib/adapters/registry';
import { requireModule } from '@/lib/modules';
import { listAbacRules, listTenants } from '@/lib/store';
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
  requireModule('admin');
  const [tenants, rules, bindings] = await Promise.all([
    listTenants(),
    listAbacRules(),
    listBindings(true),
  ]);
  const embeds = listEmbeds();
  const sellable = MODULES.filter((m) => !m.internal).map((m) => ({ id: m.id, label: m.label }));

  return (
    <div className="space-y-6">
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
                    {b.alternatives.length === 0
                      ? '—'
                      : b.alternatives.map((a) => a.vendor).join(', ')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Embedded consoles · Tier-3</CardTitle>
          <p className="text-xs text-muted-foreground">
            Rich OSS UIs we don&apos;t rebuild — surfaced as SSO&apos;d iframes to your own instance
            (mere aggregation; the tool&apos;s license never touches the core). Set the adapter URL
            to enable.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {embeds.map((e) => (
            <div key={`${e.capability}-${e.id}`} className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{e.vendor}</span>
                <Badge variant="secondary">{e.capability}</Badge>
                <Badge variant="secondary" className="text-muted-foreground">
                  {e.license}
                </Badge>
              </div>
              <EmbedFrame title={e.vendor} url={e.embedUrl} />
            </div>
          ))}
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
          <p className="mt-4 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Deny overrides allow · evaluate via POST /api/v1/admin/abac/evaluate
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
