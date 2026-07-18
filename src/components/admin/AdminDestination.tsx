import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { AddTenantButton } from '@/components/admin/AddTenantButton';
import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
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
import type { AdminDestinationId } from '@/lib/operations-destinations';
import { getOrgSystemPrompt, listTenants } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { tenantHost, tenantUrl } from '@/lib/tenant-domain';
import { MODULES } from '@/modules/registry';

const ORGANIZATION_OWNERS = [
  {
    label: 'Roles and access',
    description: 'Manage roles, grants, identities, sessions, and federation in Governance.',
    href: '/governance/access/roles',
  },
  {
    label: 'Workspace pipeline',
    description: 'Set the pipeline Chat and Projects use in Configuration.',
    href: '/operations/configuration/settings',
  },
  {
    label: 'Feature flags',
    description: 'Create, edit, toggle, and remove runtime flags in Configuration.',
    href: '/operations/configuration/feature-flags',
  },
  {
    label: 'Adapters',
    description: 'Manage connectors and inspect capability adapters in Configuration.',
    href: '/operations/configuration/adapters',
  },
] as const;

function moduleLabel(id: string): string {
  return MODULES.find((module) => module.id === id)?.label ?? id;
}

export async function AdminDestination({
  destination,
}: Readonly<{ destination: AdminDestinationId }>) {
  if (destination === 'organization') {
    const orgPrompt = await getOrgSystemPrompt(await currentOrgId());
    return <OrganizationDestination orgPrompt={orgPrompt} />;
  }

  const tenants = await listTenants();
  const modules = MODULES.filter((module) => !module.internal).map((module) => ({
    id: module.id,
    label: module.label,
  }));
  return <TenantsDestination tenants={tenants} modules={modules} />;
}

function OrganizationDestination({ orgPrompt }: Readonly<{ orgPrompt: string }>) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(24rem,0.6fr)]">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Organization instructions</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            This system block runs before each person&apos;s instructions in every chat.
          </p>
        </CardHeader>
        <CardContent>
          <OrgInstructionsEditor initial={orgPrompt} />
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Owned elsewhere</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Open the canonical management surface for each organization-wide control.
          </p>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
          {ORGANIZATION_OWNERS.map((owner) => (
            <Link
              key={owner.href}
              href={owner.href}
              className="group flex items-start justify-between gap-3 rounded-md border border-border p-3 transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>
                <span className="block text-sm font-medium text-foreground">{owner.label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {owner.description}
                </span>
              </span>
              <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

type TenantRow = Awaited<ReturnType<typeof listTenants>>[number];

function TenantsDestination({
  tenants,
  modules,
}: Readonly<{ tenants: TenantRow[]; modules: { id: string; label: string }[] }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-sm">Tenant provisioning</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Create tenant organizations and choose the modules provisioned for each one.
          </p>
        </div>
        <AddTenantButton modules={modules} />
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Provisioned modules</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell className="font-medium text-foreground">
                    {tenant.name}
                    {tenant.slug ? (
                      <a
                        href={tenantUrl(tenant.slug)}
                        className="mt-0.5 block font-mono text-[11px] font-normal text-primary hover:underline"
                      >
                        {tenantHost(tenant.slug)}
                      </a>
                    ) : (
                      <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                        no subdomain
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{tenant.plan}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {tenant.enabledModules.length === 0 ? (
                        <span className="text-xs text-muted-foreground">none</span>
                      ) : (
                        tenant.enabledModules.map((id) => (
                          <Badge
                            key={id}
                            variant="secondary"
                            className="bg-primary/10 text-primary"
                          >
                            {moduleLabel(id)}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DeleteRowButton
                      url={`/api/v1/admin/tenants/${tenant.id}`}
                      label={tenant.name}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {tenants.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No tenants yet. Add one to provision its first modules.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
