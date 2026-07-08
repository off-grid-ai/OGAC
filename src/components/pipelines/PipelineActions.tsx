'use client';

import { PencilSimple } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  type PipelineLifecycleAction,
  pipelineTransitions,
} from '@/lib/pipeline-detail';
import { panelHref, withPanelParams } from '@/lib/url-panel';

// PipelineActions — the header action cluster shared by the Overview and Gateway & Routing tabs
// (DRY: one place owns Edit + the legal lifecycle transitions). Edit is URL-driven (?panel=edit) so
// Back closes the sheet; publish/archive/restore hit the write routes and refresh the server data.
export function PipelineActions({
  pipelineId,
  status,
  name,
  showTransitions = true,
}: {
  pipelineId: string;
  status: string;
  name: string;
  /** When false, render ONLY the Edit button — the M2 Lifecycle band owns the status transitions
   *  (used on the Overview, where the PipelineLifecycle control is the source of truth). */
  showTransitions?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);

  const openEdit = useCallback(() => {
    const qs = withPanelParams(params.toString(), { panel: 'edit' });
    router.replace(panelHref(pathname, qs), { scroll: false });
  }, [params, pathname, router]);

  const run = useCallback(
    async (action: PipelineLifecycleAction, to: string) => {
      if (busy) return;
      setBusy(true);
      let res: Response;
      if (action === 'publish') {
        res = await fetch(`/api/v1/admin/pipelines/${pipelineId}/publish`, { method: 'POST' });
      } else {
        // archive / unarchive are status PATCHes (unarchive → draft so it can be re-edited).
        res = await fetch(`/api/v1/admin/pipelines/${pipelineId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: to }),
        });
      }
      setBusy(false);
      if (res.ok) {
        const verb = action === 'publish' ? 'Published' : action === 'archive' ? 'Archived' : 'Restored';
        toast.success(`${verb} "${name}"`);
        router.refresh();
      } else {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          blocked?: boolean;
          decision?: { summary?: string };
        } | null;
        // A 422 means the release gate blocked the publish — surface WHY and point to the Quality tab
        // (where the operator can review the failing evals and, if warranted, override + publish).
        if (res.status === 422 && body?.blocked) {
          toast.error(
            `${body.decision?.summary ?? 'Release gate failed.'} Review + override on the Quality tab.`,
          );
        } else {
          toast.error(body?.error ?? `Failed to ${action}`);
        }
      }
    },
    [busy, name, pipelineId, router],
  );

  const transitions = showTransitions ? pipelineTransitions(status) : [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={openEdit}>
        <PencilSimple className="size-4" /> Edit
      </Button>
      {transitions.map((t) => (
        <Button
          key={t.action}
          size="sm"
          variant={t.action === 'publish' ? 'default' : 'outline'}
          disabled={busy}
          title={t.hint}
          onClick={() => run(t.action, t.to)}
        >
          {t.label}
        </Button>
      ))}
    </div>
  );
}
