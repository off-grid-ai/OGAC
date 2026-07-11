'use client';

import { CheckCircle, Circle, UserSwitch, UsersThree } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { panelHref, withPanelParams } from '@/lib/url-panel';

const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

// The legal transitions the SERVER resolved for THIS user's role on THIS pipeline (from the pure
// allowedTransitions). Kept as a local shape so the client bundle stays lean.
export interface LifecycleTransitionData {
  action: string;
  to: string;
  label: string;
  hint: string;
  gated: boolean;
}

export interface PipelineLifecycleData {
  pipelineId: string;
  name: string;
  status: string;
  /** This user's resolved role on the pipeline ('none'|'member'|'editor'|'approver'|'admin'). */
  role: string;
  transitions: LifecycleTransitionData[];
  ownerId: string;
  team: { id: string; name: string } | null;
  /** The org's teams, for the assign-team picker. */
  teamOptions: { id: string; name: string }[];
  /** True when this user may reassign owner / move team (role ≥ editor). */
  canManageOwnership: boolean;
  /** The stage track: [{ status, label, done }] for draft → in_review → published. */
  track: { status: string; label: string }[];
  trackIndex: number;
  stageDescription: string;
}

// Lifecycle track step tint: the current step is boxed/emerald, past steps solid, future steps muted.
function trackStepClass(current: boolean, done: boolean): string {
  if (current) return 'bg-primary/10 font-medium text-primary';
  if (done) return 'text-foreground';
  return 'text-muted-foreground';
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    published: 'bg-primary/10 text-primary',
    in_review: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    deprecated: 'bg-muted text-muted-foreground',
    archived: 'bg-muted text-muted-foreground',
  };
  const cls = map[status] ?? 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  return (
    <Badge variant="secondary" className={cls}>
      {status.replace('_', ' ')}
    </Badge>
  );
}

function ReassignOwnerSheet({
  open,
  onOpenChange,
  pipelineId,
  currentOwner,
  onSaved,
}: Readonly<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pipelineId: string;
  currentOwner: string;
  onSaved: () => void;
}>) {
  const [newOwnerId, setNewOwnerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/v1/admin/pipelines/${pipelineId}/owner`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newOwnerId }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Owner reassigned to ${newOwnerId}`);
      setNewOwnerId('');
      onOpenChange(false);
      onSaved();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to reassign owner');
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Reassign owner"
      description={`Transfer ownership of this pipeline from ${currentOwner}. The new owner gets edit + promote rights; the change is audited.`}
      footer={
        <Button onClick={save} disabled={busy || !newOwnerId.trim()} className="w-full">
          Reassign owner
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ro-user">New owner (email)</Label>
          <Input
            id="ro-user"
            placeholder="new.owner@corp.example"
            value={newOwnerId}
            onChange={(e) => setNewOwnerId(e.target.value)}
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </FormSheet>
  );
}

function AssignTeamSheet({
  open,
  onOpenChange,
  pipelineId,
  currentTeamId,
  teamOptions,
  onSaved,
}: Readonly<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pipelineId: string;
  currentTeamId: string | null;
  teamOptions: { id: string; name: string }[];
  onSaved: () => void;
}>) {
  const [teamId, setTeamId] = useState(currentTeamId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/v1/admin/pipelines/${pipelineId}/team`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: teamId || null }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(teamId ? 'Team assigned' : 'Removed from team');
      onOpenChange(false);
      onSaved();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to assign team');
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Assign team"
      description="Move this pipeline to a team / BU so its members get delegated access. Clear the team to restrict access to the owner + admins."
      footer={
        <Button onClick={save} disabled={busy} className="w-full">
          Save
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="at-team">Team</Label>
          <select id="at-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className={SELECT}>
            <option value="">No team (owner + admin only)</option>
            {teamOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </FormSheet>
  );
}

// PipelineLifecycle — the Overview control showing the current STAGE on the promotion track, the
// legal next actions for THIS user's role (server-resolved), and ownership (owner + team) with
// reassign/assign. Lifecycle actions POST to the lifecycle route; `approve` runs through M1's release
// gate (a 422 surfaces WHY + points to Quality). Sheets are URL-driven so Back closes them.
export function PipelineLifecycle({ data }: Readonly<{ data: PipelineLifecycleData }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const panel = params.get('panel');
  const [busy, setBusy] = useState(false);

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  const runAction = useCallback(
    async (action: string) => {
      if (busy) return;
      setBusy(true);
      const res = await fetch(`/api/v1/admin/pipelines/${data.pipelineId}/lifecycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      setBusy(false);
      if (res.ok) {
        toast.success(`Pipeline "${data.name}" — ${action}`);
        router.refresh();
      } else {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          blocked?: boolean;
          decision?: { summary?: string };
        } | null;
        if (res.status === 422 && body?.blocked) {
          toast.error(
            `${body.decision?.summary ?? 'Release gate failed.'} Review the failing evals on the Quality tab.`,
          );
        } else {
          toast.error(body?.error ?? `Failed to ${action}`);
        }
      }
    },
    [busy, data.name, data.pipelineId, router],
  );

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Lifecycle &amp; ownership</CardTitle>
        {statusBadge(data.status)}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── promotion track: draft → in_review → published ── */}
        <div className="flex flex-wrap items-center gap-2">
          {data.track.map((s, i) => {
            const done = data.trackIndex >= 0 && i <= data.trackIndex;
            const current = i === data.trackIndex;
            return (
              <div key={s.status} className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${trackStepClass(current, done)}`}
                >
                  {done ? <CheckCircle className="size-3.5" weight="fill" /> : <Circle className="size-3.5" />}
                  {s.label}
                </span>
                {i < data.track.length - 1 ? <span className="text-muted-foreground/40">→</span> : null}
              </div>
            );
          })}
          {data.trackIndex < 0 ? (
            <span className="text-xs text-muted-foreground">
              (off the promotion track — {data.status.replace('_', ' ')})
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{data.stageDescription}</p>

        {/* ── legal actions for this role ── */}
        <div className="flex flex-wrap items-center gap-2">
          {data.transitions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {data.role === 'none'
                ? 'You do not have access to act on this pipeline.'
                : 'No actions available from this stage for your role.'}
            </p>
          ) : (
            data.transitions.map((t) => (
              <Button
                key={t.action}
                size="sm"
                variant={t.action === 'approve' || t.action === 'promote' ? 'default' : 'outline'}
                disabled={busy}
                title={t.hint}
                onClick={() => runAction(t.action)}
              >
                {t.label}
                {t.gated ? <Badge variant="outline" className="ml-1.5 text-[10px]">gated</Badge> : null}
              </Button>
            ))
          )}
        </div>

        {/* ── ownership: owner + team ── */}
        <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Owned by</div>
              <div className="truncate text-sm text-foreground">{data.ownerId || 'unassigned'}</div>
            </div>
            {data.canManageOwnership ? (
              <Button size="sm" variant="ghost" onClick={() => setPanel('reassign-owner')}>
                <UserSwitch className="size-4" /> Reassign
              </Button>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Team</div>
              <div className="truncate text-sm text-foreground">
                {data.team ? (
                  <Link href={`/governance/teams/${data.team.id}`} className="text-primary hover:underline">
                    {data.team.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">No team</span>
                )}
              </div>
            </div>
            {data.canManageOwnership ? (
              <Button size="sm" variant="ghost" onClick={() => setPanel('assign-team')}>
                <UsersThree className="size-4" /> {data.team ? 'Change' : 'Assign'}
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>

      <ReassignOwnerSheet
        open={panel === 'reassign-owner'}
        onOpenChange={(o) => !o && setPanel(null)}
        pipelineId={data.pipelineId}
        currentOwner={data.ownerId}
        onSaved={() => router.refresh()}
      />
      <AssignTeamSheet
        open={panel === 'assign-team'}
        onOpenChange={(o) => !o && setPanel(null)}
        pipelineId={data.pipelineId}
        currentTeamId={data.team?.id ?? null}
        teamOptions={data.teamOptions}
        onSaved={() => router.refresh()}
      />
    </Card>
  );
}
