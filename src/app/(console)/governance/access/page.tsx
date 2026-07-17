import { redirect } from 'next/navigation';

const LEGACY_DESTINATIONS: Readonly<Record<string, string>> = {
  users: '/governance/access/users',
  invites: '/governance/access/invitations',
  invitations: '/governance/access/invitations',
  clients: '/governance/access/clients',
  roles: '/governance/access/roles',
  sessions: '/governance/access/sessions',
  mfa: '/governance/access/mfa',
  idp: '/governance/access/federation',
  federation: '/governance/access/federation',
  realm: '/governance/access/realm',
  teams: '/governance/teams',
};

/** Preserve old tab bookmarks, then land on a canonical level-3 place. */
export default async function AccessRoot({
  searchParams,
}: Readonly<{ searchParams: Promise<{ tab?: string }> }>) {
  const { tab } = await searchParams;
  redirect((tab && LEGACY_DESTINATIONS[tab]) || '/governance/access/users');
}
