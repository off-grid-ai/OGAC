import { ArrowSquareOut, Play, Sparkle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isSimpleAgent, type AppSpec } from '@/lib/app-model';

// ─── AppsList (Builder unification, task #108) ────────────────────────────────────────────────────
// The unified builder front door renders APPS alongside agents. An "app" is the one entity the
// builder produces — a single-step app IS an agent (isSimpleAgent), a multi-step app is a workflow.
// This component is the apps half of that grid: each saved app links to its run/input surface
// (/studio/new/<id>), shows its shape (agent vs N steps) + trigger + visibility, exposes its shared
// link when published, and offers a scoped delete (DELETE /api/v1/admin/apps/<id>). Pure presentation
// over the AppSpec[] the server page reads from listApps — no I/O of its own.

const VIS_LABEL: Record<string, string> = {
  private: 'Just me',
  org: 'My org',
  public: 'Shared link',
};

export function AppsList({ apps }: { apps: AppSpec[] }) {
  if (apps.length === 0) {
    return (
      <Card className="shadow-sm">
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkle className="size-5" />
          </div>
          <p className="text-sm text-muted-foreground">
            No apps yet. Describe one in plain language and the builder wires the model, policy,
            guardrails, and grounding for you.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {apps.map((app) => {
        const shape = isSimpleAgent(app) ? 'agent' : `${app.steps.length} steps`;
        return (
          <Card key={app.id} className="shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm">{app.title}</CardTitle>
                <Badge variant="secondary" className="shrink-0 bg-muted text-muted-foreground">
                  {shape}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="line-clamp-2 text-xs text-muted-foreground">{app.summary || '—'}</p>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                <span className="rounded border border-border px-1.5 py-0.5">{app.trigger.kind}</span>
                <span className="rounded border border-border px-1.5 py-0.5">
                  {VIS_LABEL[app.visibility] ?? app.visibility}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/apps/${encodeURIComponent(app.id)}`}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                >
                  <Play className="size-3.5" />
                  Open
                </Link>
                {app.published && app.slug ? (
                  <a
                    href={`/app/${app.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ArrowSquareOut className="size-3.5" />
                    shared link
                  </a>
                ) : null}
                <div className="ml-auto">
                  <DeleteRowButton url={`/api/v1/admin/apps/${app.id}`} label={app.title} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
