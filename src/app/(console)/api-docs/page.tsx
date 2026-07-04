import { ArrowSquareOut, Code } from '@phosphor-icons/react/dist/ssr';
import { Suspense } from 'react';
import { ApiCatalog } from '@/components/api-docs/ApiCatalog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireModuleForUser } from '@/lib/module-access';
import { SERVICE_SPECS } from '@/lib/service-specs';

export const dynamic = 'force-dynamic';

const KIND_BADGE: Record<string, string> = {
  console: 'bg-primary/10 text-primary',
  native: 'bg-blue-500/10 text-blue-600',
  stub: 'text-muted-foreground',
};

export default async function ApiDocsPage() {
  await requireModuleForUser('api-docs');
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Code className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">API docs &amp; playground</h1>
          <p className="text-sm text-muted-foreground">
            The console’s public API surface, grouped by area. Try safe GET endpoints inline. For the
            full interactive OpenAPI reference, see{' '}
            <a
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              /docs
            </a>
            .
          </p>
        </div>
      </div>
      {/* Unified spec browser (Phase 5): every integrated service's OpenAPI in one place. Native
          specs are proxied server-side (no CORS, reaches LAN-only hosts) and degrade to a clear
          status when a service is down. */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Service API specs</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            OpenAPI for every integrated service, through one authed surface. Unreachable services
            report status rather than failing.
          </p>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {SERVICE_SPECS.map((s) => {
            const href = s.kind === 'console' ? '/docs' : s.kind === 'native' ? `/api/v1/specs/${s.id}` : null;
            return (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm text-foreground">{s.label}</span>
                  <Badge variant="secondary" className={KIND_BADGE[s.kind]}>
                    {s.kind === 'console' ? 'interactive' : s.kind === 'native' ? 'OpenAPI' : 'no spec'}
                  </Badge>
                </div>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ArrowSquareOut className="size-3.5" />
                    {s.kind === 'console' ? 'Open reference' : 'View spec'}
                  </a>
                ) : (
                  <span className="max-w-md text-right text-[11px] text-muted-foreground">{s.note}</span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Suspense fallback={null}>
        <ApiCatalog />
      </Suspense>
    </div>
  );
}
