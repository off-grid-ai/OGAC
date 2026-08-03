import { ArrowSquareOut, Clock, Play, Sparkle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
import { PipelineChip, type PipelineChipData } from '@/components/pipelines/PipelineChip';
import { Badge } from '@/components/ui/badge';
import { appStateNote, confusableTitles, orderAppsByAttention } from '@/lib/my-work';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isSimpleAgent, type AppSpec } from '@/lib/app-model';

// ─── AppsList (Builder unification, task #108) ────────────────────────────────────────────────────
// The unified builder front door renders APPS alongside agents. An "app" is the one entity the
// builder produces — a single-step app IS an agent (isSimpleAgent), a multi-step app is a workflow.
// This component is the apps half of that grid: each saved app links to its run/input surface
// (/apps/<id> — its lifecycle shell), shows its shape (agent vs N steps) + trigger + visibility, exposes its shared
// link when published, and offers a scoped delete (DELETE /api/v1/admin/apps/<id>). Pure presentation
// over the AppSpec[] the server page reads from listApps — no I/O of its own.

const VIS_LABEL: Record<string, string> = {
  private: 'Just me',
  org: 'My org',
  public: 'Shared link',
};

export function AppsList({
  apps,
  chips,
  waiting,
}: Readonly<{
  apps: AppSpec[];
  /** The resolved "Runs on: <pipeline>" chip per app id (page resolves them in one batch). */
  chips?: Record<string, PipelineChipData>;
  /** Cases paused for a person, per app id. The page counts them in one read. */
  waiting?: Record<string, number>;
}>) {
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

  // Cards that need a person come first; drafts sink below live apps with nothing waiting. Without
  // this the grid read as twelve equivalent options with no clue which one to open.
  // Names a reader could confuse with another app's. Computed once for the grid.
  const confusable = confusableTitles(apps.map((a) => ({ id: a.id, title: a.title })));
  const ordered = orderAppsByAttention(
    apps.map((app) => ({
      app,
      id: app.id,
      published: Boolean(app.published),
      waiting: waiting?.[app.id] ?? 0,
    })),
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {ordered.map(({ app, ...entry }) => {
        const shape = isSimpleAgent(app) ? 'agent' : `${app.steps.length} steps`;
        const note = appStateNote(entry);
        const twins = confusable[app.id];
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
              {/* THE TWO THINGS THAT DECIDE WHETHER TO OPEN THIS CARD: is it live, and is anything
                  waiting in it. Neither was on the card, so "what needs me?" meant opening each one.
                  Waiting work is a LINK — the point of knowing is to go and do it. */}
              {note ? (
                note.tone === 'attention' ? (
                  <Link
                    href="/work/tasks"
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-500"
                  >
                    <Clock className="size-3.5" />
                    {note.text}
                  </Link>
                ) : (
                  <p className="text-[11px] text-muted-foreground">{note.text}</p>
                )
              ) : null}
              {/* WHICH ONE DO I USE? Picking the wrong near-identical app is silent — you find out
                  when the wrong process happens. A warning, not a block: we cannot know two similar
                  names are actually redundant, and hiding one on a name match would eventually hide
                  the app somebody needed. */}
              {twins?.length ? (
                <p className="rounded-md border border-border bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
                  Easy to confuse with {twins.length === 1 ? twins[0] : `${twins.length} similarly named apps`}
                  {' '}— check this is the one you want.
                </p>
              ) : null}
              {/* Three lines. At two, every one of six cards cut off mid-word ("classify by IRDAI…",
                  "lapse-ris…", "sum-…") — a grid where no card finishes a sentence tells a reader
                  nothing about what any app does. Full text on hover. */}
              <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground" title={app.summary || undefined}>
                {app.summary || '—'}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                <span className="rounded border border-border px-1.5 py-0.5">{app.trigger.kind}</span>
                <span className="rounded border border-border px-1.5 py-0.5">
                  {VIS_LABEL[app.visibility] ?? app.visibility}
                </span>
              </div>
              <PipelineChip pipeline={chips?.[app.id] ?? { id: app.pipelineId ?? null }} size="xs" />
              <div className="flex items-center gap-2">
                <Link
                  href={`/solutions/apps/${encodeURIComponent(app.id)}`}
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
