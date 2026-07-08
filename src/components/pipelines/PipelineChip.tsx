// ─── PipelineChip — the ONE "Runs on: <pipeline>" chip, shared across every consumer surface ────────
//
// Pipelines are the product; the binding is what makes a consumer (an app, an agent, a chat project,
// the org-default chat) GOVERNED. This chip names that binding + deep-links to the pipeline detail, so
// the join-key is legible wherever a consumer appears. Purely presentational (no hooks / no I/O) so it
// drops into server OR client components alike — the caller resolves the binding (see resolveChip).
//
// Two honest states:
//   • bound      → "Runs on: <name>" linking to /pipelines/<id>.
//   • inherited  → the consumer pins nothing; it falls back to the org-default chat pipeline. We name
//                  that default (still a link) with an "org default" hint, OR — when no default is
//                  configured at all — a neutral "ungoverned" chip (never a fabricated pipeline).

import Link from 'next/link';
import { GitBranch } from '@phosphor-icons/react/dist/ssr';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface PipelineChipData {
  /** The RESOLVED pipeline governing this consumer (own binding, else org default). Null ⇒ ungoverned. */
  id: string | null;
  /** The resolved pipeline's display name (falls back to the id when a name isn't available). */
  name?: string | null;
  /** True when the consumer pins nothing itself and is inheriting the org-default chat pipeline. */
  inherited?: boolean;
}

export function PipelineChip({
  pipeline,
  className,
  size = 'sm',
}: {
  pipeline: PipelineChipData | null | undefined;
  className?: string;
  size?: 'sm' | 'xs';
}) {
  const text = size === 'xs' ? 'text-[11px]' : 'text-xs';

  // Ungoverned: nothing bound AND no org default resolved. Honest — not a pipeline link.
  if (!pipeline || !pipeline.id) {
    return (
      <Badge
        variant="outline"
        className={cn('gap-1 font-normal text-muted-foreground', text, className)}
        title="No governing pipeline resolved — this consumer runs ungoverned until one is bound or an org-default chat pipeline is set."
      >
        <GitBranch className="size-3" />
        Ungoverned
      </Badge>
    );
  }

  const label = pipeline.name?.trim() || pipeline.id;
  return (
    <Link
      href={`/build/pipelines/${pipeline.id}`}
      className="no-underline"
      title={
        pipeline.inherited
          ? `Inherits the org-default chat pipeline "${label}" — open it`
          : `Runs on pipeline "${label}" — open it`
      }
    >
      <Badge
        variant="outline"
        className={cn(
          'gap-1 border-primary/40 font-normal text-primary hover:bg-primary/10',
          text,
          className,
        )}
      >
        <GitBranch className="size-3" />
        <span className="text-muted-foreground">Runs on:</span>
        <span className="max-w-[14rem] truncate font-medium">{label}</span>
        {pipeline.inherited ? (
          <span className="text-muted-foreground">(org default)</span>
        ) : null}
      </Badge>
    </Link>
  );
}
