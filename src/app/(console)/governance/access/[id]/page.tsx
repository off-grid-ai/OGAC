import { Key } from '@phosphor-icons/react/dist/ssr';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { IdpList } from '@/components/access/IdpList';
import { InvitesList } from '@/components/access/InvitesList';
import { MachineClientsList } from '@/components/access/MachineClientsList';
import { MfaPanel } from '@/components/access/MfaPanel';
import { OtpPolicyPanel } from '@/components/access/OtpPolicyPanel';
import { RealmLifetimes } from '@/components/access/RealmLifetimes';
import { RolesList } from '@/components/access/RolesList';
import { SessionsPanel } from '@/components/access/SessionsPanel';
import { UsersList } from '@/components/access/UsersList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { requireModuleForUser } from '@/lib/module-access';
import { AccessReviewPanel } from '@/components/access/AccessReviewPanel';
import { listAccessReviews } from '@/lib/access-reviews-store';
import { lastAuditedActivityByEmail } from '@/lib/access-activity';
import { listUsers } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

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
    mfa: (
      <>
        <OtpPolicyPanel />
        <MfaPanel />
      </>
    ),
    federation: <IdpList />,
    realm: <RealmLifetimes />,
  };
  return <div className="w-full space-y-4">{content[destination]}</div>;
}

// The access-review surface: the live list + the artefacts already recorded.
async function AccessReviewSurface() {
  const org = await currentOrgId();
  const [people, past] = await Promise.all([listUsers(org), listAccessReviews(org, 10)]);
  // Last activity is what makes a review meaningful — a list of names with no usage signal is what
  // gets rubber-stamped. If the ledger is unreachable we get an empty map, and every row then reads
  // "has never signed in", which is a fabricated finding — so that case is surfaced instead.
  const activity = await lastAuditedActivityByEmail(org).catch(() => null);
  const now = new Date().toISOString();
  return (
    <div className="w-full space-y-4">
      <AccessReviewPanel
        subjects={people.map((u) => ({
          id: u.id,
          email: u.email ?? '',
          name: u.name,
          role: u.role,
          lastActiveAt: activity?.[(u.email ?? '').toLowerCase()] ?? null,
        }))}
        lastReviewedAt={past[0]?.completedAt.toISOString() ?? null}
        lastReviewedBy={past[0]?.reviewedBy ?? null}
        now={now}
        activityAvailable={activity !== null}
      />
      {past.length ? (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Reviews already on record</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {past.map((r) => (
                <li key={r.id} className="text-xs">
                  <span className="font-medium text-foreground">
                    {r.completedAt.toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    — {r.summary}
                    {r.reviewedBy ? ` · certified by ${r.reviewedBy}` : ' · reviewer not recorded'}
                  </span>
                  {r.applied.some((a) => !a.ok) ? (
                    <span className="ml-1 text-amber-700 dark:text-amber-500">
                      · {r.applied.filter((a) => !a.ok).length} decision(s) did not apply
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// User detail — the deep-linkable "place" a user opens to from the Access → Users list.
// Same env gate as the list page: without the Keycloak-admin env there is nothing to show.
export default async function AccessDestinationPage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  await requireModuleForUser('admin');
  const { id } = await params;
  if (id === 'teams') redirect('/governance/teams');
  if (id === 'invites') redirect('/governance/access/invitations');
  if (id === 'idp') redirect('/governance/access/federation');
  // NOT behind the identity-provider gate: this reviews the CONSOLE's own user list, which exists
  // whether or not Keycloak is wired. Gating it would hide the artefact on exactly the deployments
  // most likely to be asked for it.
  if (id === 'review') return <AccessReviewSurface />;
  if (isAccessDestination(id)) {
    return keycloakAdmin() ? (
      <AccessDestinationContent destination={id} />
    ) : (
      <IdentityProviderUnavailable />
    );
  }
  redirect(`/governance/access/users/${encodeURIComponent(id)}`);
}
