import { Code } from '@phosphor-icons/react/dist/ssr';
import { Suspense } from 'react';
import { ApiCatalog } from '@/components/api-docs/ApiCatalog';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

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
      <Suspense fallback={null}>
        <ApiCatalog />
      </Suspense>
    </div>
  );
}
