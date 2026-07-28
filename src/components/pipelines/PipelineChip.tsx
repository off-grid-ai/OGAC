// ─── PipelineChip — the ONE "Runs on: <pipeline>" chip, shared across every consumer surface ────────
//
// Pipelines are the product; the binding is what makes a consumer (an app, an agent, a chat project,
// the org-default chat) GOVERNED. This chip names that binding + deep-links to the pipeline detail, so
// the join-key is legible wherever a consumer appears. Purely presentational (no hooks / no I/O) so it
// drops into server OR client components alike — the caller resolves the binding (see resolveChip).
//
// Three honest states:
//   • bound      → "Runs on: <name>" linking to /pipelines/<id>.
//   • inherited  → the consumer pins nothing; it falls back to the org-default chat pipeline. We name
//                  that default (still a link) with an "org default" hint, OR — when no default is
//                  configured at all — a neutral "ungoverned" chip (never a fabricated pipeline).
//   • missing    → an id is bound but no such pipeline exists in this org. Stated inline and NOT a
//                  link: the whole defect was a confident chip deep-linking an operator into a 404.

import { GitBranch, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import type { PipelineChipData } from '@/lib/pipeline-chip-policy';
import { cn } from '@/lib/utils';

export type { PipelineChipData };

export function PipelineChip({
  pipeline,
  className,
  containerClassName,
  size = 'sm',
}: Readonly<{
  pipeline: PipelineChipData | null | undefined;
  className?: string;
  containerClassName?: string;
  size?: 'sm' | 'xs';
}>) {
  const text = size === 'xs' ? 'text-[11px]' : 'text-xs';

  // Ungoverned: nothing bound AND no org default resolved. Honest — not a pipeline link.
  if (!pipeline?.id) {
    return (
      <Badge
        variant="outline"
        className={cn('gap-1 font-normal text-muted-foreground', text, className)}
        title="No governing pipeline resolved — this consumer runs ungoverned until one is bound or an org-default chat pipeline is set."
      >
        <GitBranch className="size-3" />
        No pipeline
      </Badge>
    );
  }

  const label = pipeline.name?.trim() || pipeline.id;

  // Bound to a pipeline that isn't in this org. Say so where the operator is looking, and give them
  // the id — it's what they need to repair the binding or recognise a cross-deployment paste.
  if (pipeline.missing) {
    return (
      <Badge
        variant="outline"
        className={cn(
          'gap-1 border-destructive/40 font-normal text-destructive',
          text,
          className,
        )}
        title={`This consumer is bound to pipeline "${pipeline.id}", which does not exist in this organisation. It is NOT governed by that pipeline — re-bind it to a pipeline that exists.`}
      >
        <WarningCircle className="size-3" />
        <span className="max-w-[10rem] truncate sm:max-w-[18rem]">
          Pipeline not found: {pipeline.id}
        </span>
      </Badge>
    );
  }

  return (
    <Link
      href={`/runtime/pipelines/${pipeline.id}`}
      className={cn('min-w-0 no-underline', containerClassName)}
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
        <span className={cn('text-muted-foreground', size === 'xs' && 'hidden md:inline')}>
          Runs on:
        </span>
        <span className="max-w-[7rem] truncate font-medium sm:max-w-[14rem]">{label}</span>
        {pipeline.inherited ? (
          <span className="hidden text-muted-foreground lg:inline">(org default)</span>
        ) : null}
      </Badge>
    </Link>
  );
}
