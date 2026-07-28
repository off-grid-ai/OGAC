// ─── PipelineNotFound — the degraded pipeline-detail state ──────────────────────────────────────────
//
// Reached when a pipeline id resolves to no row in the CURRENT org. Previously this route called
// notFound(), which dropped the operator on a generic 404 with no id, no org context and no way
// forward — the worst possible landing for the common causes: seed drift between deployments, a
// deleted pipeline still referenced by an app, or an id pasted from another org.
//
// "Not found in this organisation" is deliberately narrower than "does not exist". The read is
// org-scoped, so that is the only claim the data supports.

import { ArrowLeft, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function PipelineNotFound({ id }: Readonly<{ id: string }>) {
  return (
    <div className="w-full">
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <WarningCircle className="size-4 text-destructive" />
            Pipeline not found in this organisation
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              No pipeline with this id exists in the organisation you are signed into. It may have
              been deleted, or the id may belong to a different organisation or deployment.
            </p>
            <p className="font-mono text-xs break-all text-foreground">{id}</p>
          </div>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              If a consumer — an app, an agent, or a chat project — is bound to this id, it is{' '}
              <span className="text-foreground">not governed by that pipeline</span>. Re-bind it to a
              pipeline that exists here.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/runtime/pipelines">
                <ArrowLeft className="size-3" />
                All pipelines
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
