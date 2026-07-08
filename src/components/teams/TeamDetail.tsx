'use client';

import { ArrowLeft, FlowArrow, Trash, UserPlus } from '@phosphor-icons/react/dist/ssr';
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
import { Textarea } from '@/components/ui/textarea';
import { pipelineTabHref } from '@/lib/pipeline-detail';
import { panelHref, withPanelParams } from '@/lib/url-panel';

const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

export interface TeamDetailData {
  id: string;
  name: string;
  description: string;
  members: { id: string; userId: string; role: string }[];
  pipelines: { id: string; name: string; status: string }[];
}

function roleBadge(role: string) {
  return role === 'lead' ? (
    <Badge variant="secondary" className="bg-primary/10 text-primary">
      lead
    </Badge>
  ) : (
    <Badge variant="outline">member</Badge>
  );
}

function EditTeamSheet({
  open,
  onOpenChange,
  team,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  team: TeamDetailData;
  onSaved: () => void;
}) {
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/v1/admin/teams/${team.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success('Team updated');
      onOpenChange(false);
      onSaved();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to update team');
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit team"
      description="Rename the team or update its description."
      footer={
        <Button onClick={save} disabled={busy || !name.trim()} className="w-full">
          Save changes
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="et-name">Name</Label>
          <Input id="et-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="et-desc">Description</Label>
          <Textarea
            id="et-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </FormSheet>
  );
}

function AddMemberSheet({
  open,
  onOpenChange,
  teamId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  teamId: string;
  onSaved: () => void;
}) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/v1/admin/teams/${teamId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Added ${userId}`);
      setUserId('');
      setRole('member');
      onOpenChange(false);
      onSaved();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to add member');
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add member"
      description="A lead gets delegated edit + promote on the team's pipelines; a member gets delegated read + deprecate. Re-adding an existing user updates their role."
      footer={
        <Button onClick={save} disabled={busy || !userId.trim()} className="w-full">
          Add member
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="mm-user">User (email)</Label>
          <Input
            id="mm-user"
            placeholder="analyst@corp.example"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mm-role">Role</Label>
          <select id="mm-role" value={role} onChange={(e) => setRole(e.target.value)} className={SELECT}>
            <option value="member">Member — read + deprecate</option>
            <option value="lead">Lead — edit + promote</option>
          </select>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </FormSheet>
  );
}

// Team detail — full entity + its actions: edit/delete the team, add/remove members (with role),
// and the pipelines assigned to it. URL-driven sheets (?panel=edit-team / add-member) so Back closes
// them. Full-width, list→detail (each pipeline links to its own detail).
export function TeamDetail({ team }: { team: TeamDetailData }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const panel = params.get('panel');

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  const removeMember = useCallback(
    async (memberId: string, userId: string) => {
      if (!confirm(`Remove ${userId} from this team?`)) return;
      const res = await fetch(`/api/v1/admin/teams/${team.id}/members/${memberId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success(`Removed ${userId}`);
        router.refresh();
      } else {
        toast.error('Failed to remove member');
      }
    },
    [router, team.id],
  );

  const deleteTeam = useCallback(async () => {
    if (
      !confirm(
        `Delete team "${team.name}"? Memberships are removed and assigned pipelines are un-assigned.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/v1/admin/teams/${team.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Team deleted');
      router.push('/governance/teams');
    } else {
      toast.error('Failed to delete team');
    }
  }, [router, team.id, team.name]);

  return (
    <div className="w-full space-y-6">
      <Link
        href="/governance/teams"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" /> Teams
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-lg font-medium text-foreground">{team.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{team.description || 'No description.'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPanel('edit-team')}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={deleteTeam}
          >
            <Trash className="size-4" /> Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Members */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Members ({team.members.length})</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setPanel('add-member')}>
              <UserPlus className="size-4" /> Add member
            </Button>
          </CardHeader>
          <CardContent>
            {team.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No members yet. Add a lead or member to delegate access to this team&apos;s pipelines.
              </p>
            ) : (
              <ul className="divide-y">
                {team.members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-foreground">{m.userId}</span>
                      {roleBadge(m.role)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeMember(m.id, m.userId)}
                    >
                      <Trash className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Assigned pipelines */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FlowArrow className="size-4 text-primary" /> Pipelines ({team.pipelines.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {team.pipelines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No pipelines assigned to this team yet. Assign one from a pipeline&apos;s Overview
                (Ownership → team).
              </p>
            ) : (
              <ul className="divide-y">
                {team.pipelines.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link
                      href={pipelineTabHref(p.id, 'overview')}
                      className="truncate text-primary hover:underline"
                    >
                      {p.name}
                    </Link>
                    <Badge variant="outline" className="shrink-0 capitalize">
                      {p.status.replace('_', ' ')}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <EditTeamSheet
        open={panel === 'edit-team'}
        onOpenChange={(o) => !o && setPanel(null)}
        team={team}
        onSaved={() => router.refresh()}
      />
      <AddMemberSheet
        open={panel === 'add-member'}
        onOpenChange={(o) => !o && setPanel(null)}
        teamId={team.id}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
