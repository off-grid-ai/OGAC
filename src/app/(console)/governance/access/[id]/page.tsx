import { ArrowLeft, Key } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { UserActivityPanel } from '@/components/access/UserActivityPanel';
import { UserDetailPanel } from '@/components/access/UserDetailPanel';
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
  const sp = await searchParams;
  const rawTab = Array.isArray(sp.subtab) ? sp.subtab[0] : sp.subtab;
  const subtab: SubTab = rawTab === 'activity' ? 'activity' : 'identity';
  const configured = keycloakAdmin() !== null;

  let identityPanel: React.ReactNode;
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
        href="/governance/access?tab=users"
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
