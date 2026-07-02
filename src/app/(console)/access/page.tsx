import { Key } from '@phosphor-icons/react/dist/ssr';
import { AccessTabs } from '@/components/access/AccessTabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

export default async function AccessPage() {
  await requireModuleForUser('admin');
  // Check the env directly. The old code did an internal HTTP call to our own admin
  // API, but that request carries no session/token and the middleware blocks it — so
  // the page ALWAYS read "not configured" even when the env was set. keycloakAdmin()
  // returns null iff the Keycloak-admin env is unset.
  const configured = keycloakAdmin() !== null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Users &amp; Access</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage users, roles and machine clients via Keycloak.
        </p>
      </div>

      {configured ? (
        <AccessTabs />
      ) : (
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Key className="size-4" />
            </div>
            <CardTitle className="text-sm">Keycloak not configured</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Set the following environment variables to connect Off Grid to your Keycloak realm.
            </p>
            <div className="rounded-md border border-border bg-muted/40 p-4 font-mono text-xs space-y-1">
              <div>
                <span className="text-primary">OFFGRID_KEYCLOAK_URL</span>
                <span className="text-muted-foreground ml-2"># e.g. https://auth.example.com</span>
              </div>
              <div>
                <span className="text-primary">OFFGRID_KEYCLOAK_REALM</span>
                <span className="text-muted-foreground ml-2"># e.g. offgrid</span>
              </div>
              <div>
                <span className="text-primary">OFFGRID_KEYCLOAK_ADMIN_CLIENT_ID</span>
                <span className="text-muted-foreground ml-2"># service account client ID</span>
              </div>
              <div>
                <span className="text-primary">OFFGRID_KEYCLOAK_ADMIN_CLIENT_SECRET</span>
                <span className="text-muted-foreground ml-2"># service account secret</span>
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              The service account must be granted the{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">realm-management</code> client
              role inside Keycloak so it can read and write users, roles, and clients on behalf of the
              console.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
