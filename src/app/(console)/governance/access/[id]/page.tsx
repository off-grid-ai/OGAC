import { ArrowLeft, Key } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { IdpList } from '@/components/access/IdpList';
import { InvitesList } from '@/components/access/InvitesList';
import { MachineClientsList } from '@/components/access/MachineClientsList';
import { MfaPanel } from '@/components/access/MfaPanel';
import { RealmLifetimes } from '@/components/access/RealmLifetimes';
import { RolesList } from '@/components/access/RolesList';
import { SessionsPanel } from '@/components/access/SessionsPanel';
import { UserActivityPanel } from '@/components/access/UserActivityPanel';
import { UserDetailPanel } from '@/components/access/UserDetailPanel';
import { UsersList } from '@/components/access/UsersList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// The sub-tabs of a user's detail place. URL-driven (?subtab=) so Back steps between them and each
// is deep-linkable (nav rule). "identity" is the existing roles/password/MFA/sessions management;
// "activity" is the governance/audit lens — every prompt, chat, query, and run this person made.
const SUBTABS = [
  { id: 'identity', label: 'Identity & access' },
  { id: 'activity', label: 'Activity' },
] as const;
type SubTab = (typeof SUBTABS)[number]['id'];

const ACCESS_DESTINATIONS = [
  'users',
  'invitations',
  'clients',
  'roles',
  'sessions',
  'mfa',
  'federation',
  'realm',
] as const;
type AccessDestination = (typeof ACCESS_DESTINATIONS)[number];

function isAccessDestination(value: string): value is AccessDestination {
  return ACCESS_DESTINATIONS.some((destination) => destination === value);
}

function IdentityProviderUnavailable() {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Key className="size-4" />
        </div>
        <CardTitle className="text-sm">Identity provider not configured</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Connect an identity provider before managing people, clients, roles, or sessions.
        </p>
        <div className="space-y-1 rounded-md border border-border bg-muted/40 p-4 font-mono text-xs">
          <div>OFFGRID_KEYCLOAK_URL</div>
          <div>OFFGRID_KEYCLOAK_REALM</div>
          <div>OFFGRID_KEYCLOAK_ADMIN_CLIENT_ID</div>
          <div>OFFGRID_KEYCLOAK_ADMIN_CLIENT_SECRET</div>
        </div>
        <p className="text-xs text-muted-foreground">
          Grant the service account the{' '}
          <code className="rounded bg-muted px-1 py-0.5">realm-management</code> client role so the
          console can manage identities.
        </p>
      </CardContent>
    </Card>
  );
}

function AccessDestinationContent({ destination }: Readonly<{ destination: AccessDestination }>) {
  const content: Record<AccessDestination, ReactNode> = {
    users: <UsersList />,
    invitations: <InvitesList />,
    clients: <MachineClientsList />,
    roles: <RolesList />,
    sessions: <SessionsPanel />,
    mfa: <MfaPanel />,
    federation: <IdpList />,
    realm: <RealmLifetimes />,
  };
  return <div className="w-full space-y-4">{content[destination]}</div>;
}

// User detail — the deep-linkable "place" a user opens to from the Access → Users list.
// Same env gate as the list page: without the Keycloak-admin env there is nothing to show.
export default async function UserDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await requireModuleForUser('admin');
  const { id } = await params;
  if (id === 'teams') redirect('/governance/teams');
  if (id === 'invites') redirect('/governance/access/invitations');
  if (id === 'idp') redirect('/governance/access/federation');
  if (isAccessDestination(id)) {
    return keycloakAdmin() ? (
      <AccessDestinationContent destination={id} />
    ) : (
      <IdentityProviderUnavailable />
    );
  }
  const sp = await searchParams;
  const rawTab = Array.isArray(sp.subtab) ? sp.subtab[0] : sp.subtab;
  const subtab: SubTab = rawTab === 'activity' ? 'activity' : 'identity';
  const configured = keycloakAdmin() !== null;

  let identityPanel: ReactNode;
  if (configured) {
    identityPanel = <UserDetailPanel userId={id} />;
  } else {
    identityPanel = (
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Key className="size-4" />
          </div>
          <CardTitle className="text-sm">Identity provider not configured</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Set the identity-provider environment variables (see the Users &amp; Access page) to
          manage users.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full space-y-6">
      <Link
        href="/governance/access/users"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Users &amp; Access
      </Link>

      <div className="flex gap-1 border-b border-border">
        {SUBTABS.map((t) => (
          <Link
            key={t.id}
            href={`/governance/access/${id}?subtab=${t.id}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              subtab === t.id
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {subtab === 'activity' ? <UserActivityPanel userId={id} /> : identityPanel}
    </div>
  );
}
