'use client';

import {
  Buildings,
  CaretDown,
  CaretRight,
  Plus,
  Trash,
  UserPlus,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AddTeamSheet } from '@/components/teams/TeamsManager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingBlock } from '@/components/ui/spinner';
import {
  type DepartmentGroup,
  distinctDepartments,
  groupTeamsByDepartment,
} from '@/lib/teams-policy';
import { panelHref, withPanelParams } from '@/lib/url-panel';

// ─── The Access "Teams & Departments" tab — the ORG CHART entry point ────────────────────────────
// People-centric view of the team tier: DEPARTMENT → TEAM → MEMBERS. Reuses the teams lib data
// (fetched from the admin API), the pure grouping helper (groupTeamsByDepartment), and the shared
// AddTeamSheet — no CRUD is duplicated. Each team drills into its detail home at
// /governance/teams/[id]; members can be added/removed here via the same admin routes.

const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

interface TeamRow {
  id: string;
  name: string;
  description: string;
  department: string | null;
  memberCount: number;
}
interface MemberRow {
  id: string;
  userId: string;
  role: string;
}

function AddMemberSheet({
  open,
  onOpenChange,
  teamId,
  teamName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  teamId: string | null;
  teamName: string;
  onSaved: () => void;
}) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy || !teamId) return;
    setError(null);
    setBusy(true);
    const res = await fetch(`/api/v1/admin/teams/${teamId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Added ${userId} to ${teamName}`);
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
      title={`Add member to ${teamName}`}
      description="A lead gets delegated edit + promote on the team's pipelines; a member gets delegated read + deprecate. Re-adding an existing user updates their role."
      footer={
        <Button onClick={save} disabled={busy || !userId.trim()} className="w-full">
          Add member
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="td-user">User (email)</Label>
          <Input
            id="td-user"
            placeholder="analyst@corp.example"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="td-role">Role</Label>
          <select id="td-role" value={role} onChange={(e) => setRole(e.target.value)} className={SELECT}>
            <option value="member">Member — read + deprecate</option>
            <option value="lead">Lead — edit + promote</option>
          </select>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </FormSheet>
  );
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

function TeamNode({
  team,
  members,
  onAddMember,
  onRemoveMember,
}: {
  team: TeamRow;
  members: MemberRow[] | undefined;
  onAddMember: (t: TeamRow) => void;
  onRemoveMember: (teamId: string, memberId: string, userId: string) => void;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="min-w-0">
          <Link href={`/governance/teams/${team.id}`} className="hover:underline">
            <CardTitle className="flex items-center gap-2 truncate text-sm">
              <UsersThree className="size-4 text-primary" /> {team.name}
            </CardTitle>
          </Link>
          {team.description ? (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{team.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline">
            {team.memberCount} member{team.memberCount === 1 ? '' : 's'}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => onAddMember(team)}>
            <UserPlus className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {members === undefined ? (
          <LoadingBlock label="Loading members…" />
        ) : members.length === 0 ? (
          <p className="text-xs text-muted-foreground">No members yet.</p>
        ) : (
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-foreground">{m.userId}</span>
                  {roleBadge(m.role)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onRemoveMember(team.id, m.id, m.userId)}
                >
                  <Trash className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 pt-1">
          <Link href={`/governance/teams/${team.id}`} className="text-xs text-primary hover:underline">
            Open team →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function DepartmentSection({
  group,
  membersByTeam,
  onAddMember,
  onRemoveMember,
}: {
  group: DepartmentGroup<TeamRow>;
  membersByTeam: Record<string, MemberRow[] | undefined>;
  onAddMember: (t: TeamRow) => void;
  onRemoveMember: (teamId: string, memberId: string, userId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const memberTotal = group.teams.reduce((n, t) => n + t.memberCount, 0);
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? (
          <CaretDown className="size-4 text-muted-foreground" />
        ) : (
          <CaretRight className="size-4 text-muted-foreground" />
        )}
        <Buildings className={`size-4 ${group.unassigned ? 'text-muted-foreground' : 'text-primary'}`} />
        <h2 className="text-sm font-medium text-foreground">{group.department}</h2>
        <Badge variant="outline" className="ml-1 text-[10px] font-normal">
          {group.teams.length} team{group.teams.length === 1 ? '' : 's'} · {memberTotal} member
          {memberTotal === 1 ? '' : 's'}
        </Badge>
      </button>
      {open ? (
        <div className="grid gap-4 pl-6 sm:grid-cols-2 xl:grid-cols-3">
          {group.teams.map((t) => (
            <TeamNode
              key={t.id}
              team={t}
              members={membersByTeam[t.id]}
              onAddMember={onAddMember}
              onRemoveMember={onRemoveMember}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function TeamsDepartments() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [teams, setTeams] = useState<TeamRow[] | null>(null);
  const [membersByTeam, setMembersByTeam] = useState<Record<string, MemberRow[] | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [addMemberTeam, setAddMemberTeam] = useState<TeamRow | null>(null);

  const newTeamOpen = params.get('panel') === 'new-team';

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch('/api/v1/admin/teams');
    if (!res.ok) {
      setError('Failed to load teams');
      setTeams([]);
      return;
    }
    const body = (await res.json()) as { data?: TeamRow[] };
    const list = body.data ?? [];
    setTeams(list);
    // Fetch each team's members in parallel so the org chart is fully expanded.
    const entries = await Promise.all(
      list.map(async (t): Promise<[string, MemberRow[]]> => {
        const mRes = await fetch(`/api/v1/admin/teams/${t.id}/members`);
        if (!mRes.ok) return [t.id, []];
        const mBody = (await mRes.json()) as { data?: MemberRow[] };
        return [t.id, mBody.data ?? []];
      }),
    );
    setMembersByTeam(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const removeMember = useCallback(
    async (teamId: string, memberId: string, userId: string) => {
      if (!confirm(`Remove ${userId} from this team?`)) return;
      const res = await fetch(`/api/v1/admin/teams/${teamId}/members/${memberId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success(`Removed ${userId}`);
        void load();
      } else {
        toast.error('Failed to remove member');
      }
    },
    [load],
  );

  const groups = useMemo(() => groupTeamsByDepartment(teams ?? []), [teams]);
  const departments = useMemo(() => distinctDepartments(teams ?? []), [teams]);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="text-sm font-medium text-foreground">Teams &amp; Departments</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your org chart: departments group the teams that own and govern pipelines, and each team
            grants its members delegated access. Create a team, assign it to a department, and add
            people here — the same teams surface as{' '}
            <Link href="/governance/teams" className="text-primary hover:underline">
              Governance → Teams
            </Link>
            .
          </p>
        </div>
        <Button size="sm" onClick={() => setPanel('new-team')}>
          <Plus className="size-4" /> New team
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {teams === null ? (
        <LoadingBlock label="Loading the org chart…" />
      ) : teams.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No teams yet. Create one and assign it to a department to build your org chart.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <DepartmentSection
              key={g.department}
              group={g}
              membersByTeam={membersByTeam}
              onAddMember={(t) => setAddMemberTeam(t)}
              onRemoveMember={removeMember}
            />
          ))}
        </div>
      )}

      <AddTeamSheet
        open={newTeamOpen}
        onOpenChange={(o) => !o && setPanel(null)}
        onSaved={() => void load()}
        departments={departments}
      />
      <AddMemberSheet
        open={addMemberTeam !== null}
        onOpenChange={(o) => !o && setAddMemberTeam(null)}
        teamId={addMemberTeam?.id ?? null}
        teamName={addMemberTeam?.name ?? ''}
        onSaved={() => void load()}
      />
    </div>
  );
}
