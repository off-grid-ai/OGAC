import { ArrowLeft, Key } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { UserDetailPanel } from '@/components/access/UserDetailPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// User detail — the deep-linkable "place" a user opens to from the Access → Users list.
// Same env gate as the list page: without the Keycloak-admin env there is nothing to show.
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('admin');
  const { id } = await params;
  const configured = keycloakAdmin() !== null;

  return (
    <div className="space-y-6">
      <Link
        href="/governance/access?tab=users"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Users &amp; Access
      </Link>

      {configured ? (
        <UserDetailPanel userId={id} />
      ) : (
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
      )}
    </div>
  );
}
