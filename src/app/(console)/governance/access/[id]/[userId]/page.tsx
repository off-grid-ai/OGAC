import { ArrowLeft, Key } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { UserActivityPanel } from '@/components/access/UserActivityPanel';
import { UserDetailPanel } from '@/components/access/UserDetailPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

const SUBTABS = [
  { id: 'identity', label: 'Identity & access' },
  { id: 'activity', label: 'Activity' },
] as const;
type SubTab = (typeof SUBTABS)[number]['id'];

export default async function UserDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string; userId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await requireModuleForUser('admin');
  const { id, userId } = await params;
  if (id !== 'users') notFound();
  const sp = await searchParams;
  const rawTab = Array.isArray(sp.subtab) ? sp.subtab[0] : sp.subtab;
  const subtab: SubTab = rawTab === 'activity' ? 'activity' : 'identity';
  const configured = keycloakAdmin() !== null;

  let identityPanel: ReactNode;
  if (configured) {
    identityPanel = <UserDetailPanel userId={userId} />;
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
          Set the identity-provider environment variables from Access before managing users.
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
        Users
      </Link>

      <div className="flex gap-1 border-b border-border">
        {SUBTABS.map((tab) => (
          <Link
            key={tab.id}
            href={`/governance/access/users/${encodeURIComponent(userId)}?subtab=${tab.id}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              subtab === tab.id
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {subtab === 'activity' ? <UserActivityPanel userId={userId} /> : identityPanel}
    </div>
  );
}
