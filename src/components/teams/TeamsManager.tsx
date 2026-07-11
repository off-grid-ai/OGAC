'use client';

import { Plus, Trash, UsersThree } from '@phosphor-icons/react/dist/ssr';
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
import { distinctDepartments } from '@/lib/teams-policy';
import { panelHref, withPanelParams } from '@/lib/url-panel';

// The shape the server hands us (subset of TeamView; kept local so the client bundle stays lean).
export interface TeamCardData {
  id: string;
  name: string;
  description: string;
  department: string | null;
  memberCount: number;
}

function TeamCard({ t, onDelete }: Readonly<{ t: TeamCardData; onDelete: (t: TeamCardData) => void }>) {
  return (
    <Card className="flex flex-col shadow-sm transition-colors hover:border-primary/40">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="min-w-0">
          <Link href={`/governance/teams/${t.id}`} className="hover:underline">
            <CardTitle className="flex items-center gap-2 truncate text-sm">
              <UsersThree className="size-4 text-primary" /> {t.name}
            </CardTitle>
          </Link>
          {t.department ? (
            <Badge variant="outline" className="mt-1 text-[10px] font-normal">
              {t.department}
            </Badge>
          ) : null}
        </div>
        <Badge variant="outline" className="shrink-0">
          {t.memberCount} member{t.memberCount === 1 ? '' : 's'}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-xs text-muted-foreground">
        <p className="h-8 overflow-hidden text-ellipsis leading-4 line-clamp-2">
          {t.description || 'No description.'}
        </p>
        <div className="mt-auto flex items-center justify-between pt-2">
          <Link href={`/governance/teams/${t.id}`} className="text-primary hover:underline">
            Open →
          </Link>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => onDelete(t)}
          >
            <Trash className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AddTeamSheet({
  open,
  onOpenChange,
  onSaved,
  departments = [],
  defaultDepartment = '',
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  /** Existing department names, offered as datalist suggestions. */
  departments?: string[];
  /** Pre-fill the department (e.g. when creating from within a department group). */
  defaultDepartment?: string;
}>) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [department, setDepartment] = useState(defaultDepartment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await fetch('/api/v1/admin/teams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, description, department: department.trim() || null }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Team "${name}" created`);
      setName('');
      setDescription('');
      setDepartment(defaultDepartment);
      onOpenChange(false);
      onSaved();
    } else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to create team');
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New team"
      description="A team / business unit between the org and the pipeline. Add members, then assign pipelines to the team so members get delegated access to run and maintain them."
      footer={
        <Button onClick={save} disabled={busy || !name.trim()} className="w-full">
          Create team
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="tm-name">Name</Label>
          <Input
            id="tm-name"
            placeholder="Tax & Accounting"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tm-dept">Department (optional)</Label>
          <Input
            id="tm-dept"
            list="tm-dept-options"
            placeholder="Finance"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          />
          <datalist id="tm-dept-options">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <p className="text-[11px] text-muted-foreground">
            Groups this team under a department in the org chart. Leave blank for Unassigned.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tm-desc">Description</Label>
          <Textarea
            id="tm-desc"
            placeholder="What this business unit owns and governs."
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

// The Teams library surface — full-width grid of team cards + a URL-driven New sheet
// (?panel=new-team so Back closes it and it's deep-linkable). Each card → the team detail page.
export function TeamsManager({ teams }: Readonly<{ teams: TeamCardData[] }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = params.get('panel') === 'new-team';

  const setPanel = useCallback(
    (value: string | null) => {
      const qs = withPanelParams(params.toString(), { panel: value });
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  const onDelete = useCallback(
    async (t: TeamCardData) => {
      if (
        !confirm(
          `Delete team "${t.name}"? Its memberships are removed and any pipeline assigned to it is un-assigned (falls back to owner + admin access).`,
        )
      ) {
        return;
      }
      const res = await fetch(`/api/v1/admin/teams/${t.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(`Team "${t.name}" deleted`);
        router.refresh();
      } else {
        toast.error('Failed to delete team');
      }
    },
    [router],
  );

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium text-foreground">Teams</h1>
          <p className="text-sm text-muted-foreground">
            Teams / business units between the org and the pipeline. A pipeline can belong to a team;
            its members get delegated access to run and maintain the team&apos;s pipelines.
          </p>
        </div>
        <Button size="sm" onClick={() => setPanel('new-team')}>
          <Plus className="size-4" />
          New team
        </Button>
      </div>

      {teams.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No teams yet. Create one to delegate pipeline access to a business unit.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {teams.map((t) => (
            <TeamCard key={t.id} t={t} onDelete={onDelete} />
          ))}
        </div>
      )}

      <AddTeamSheet
        open={open}
        onOpenChange={(o) => !o && setPanel(null)}
        onSaved={() => router.refresh()}
        departments={distinctDepartments(teams)}
      />
    </div>
  );
}
