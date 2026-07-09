'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  APP_SHARE_ROLES,
  type AppGrant,
  type AppShareRole,
} from '@/lib/app-sharing-policy';

// ─── AppShareManager — Google-Doc-style per-app SHARING ──────────────────────────────────────────
//
// Grants existing KEYCLOAK users access to THIS app at an app-role. The creator/owner picks a user
// (typeahead over the realm's users), a role (viewer/runner/approver/editor), and adds a grant;
// current shares list below with a revoke button each. The owner + admins + the owner's upward
// management chain always have access without a grant — shown as a read-only note. All grant
// precedence + role→action mapping lives in app-sharing-policy.ts; this only shapes the form + calls
// /api/v1/admin/apps/[id]/shares.

interface KcUserLite {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

const ROLE_HINT: Record<AppShareRole, string> = {
  viewer: 'See detail, runs & reports',
  runner: 'View + run & trigger',
  approver: 'Run + satisfy HITL approvals',
  editor: 'Full — edit the app & its policy',
};

function userLabel(u: KcUserLite): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  const handle = u.email || u.username;
  return name ? `${name} · ${handle}` : handle;
}

export function AppShareManager({
  appId,
  ownerId,
  initialGrants,
}: {
  appId: string;
  ownerId: string;
  initialGrants: AppGrant[];
}) {
  const [grants, setGrants] = React.useState<AppGrant[]>(initialGrants);
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<KcUserLite[]>([]);
  const [selected, setSelected] = React.useState<string>('');
  const [role, setRole] = React.useState<AppShareRole>('runner');
  const [busy, setBusy] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [kcConfigured, setKcConfigured] = React.useState(true);

  // Debounced typeahead over Keycloak users (reuses the admin users list route).
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/admin/access/users?search=${encodeURIComponent(q)}&max=10`);
        const j = (await res.json()) as { configured?: boolean; users?: KcUserLite[] };
        if (cancelled) return;
        if (j.configured === false) {
          setKcConfigured(false);
          setResults([]);
        } else {
          setKcConfigured(true);
          setResults(j.users ?? []);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  async function addGrant() {
    const userId = (selected || query).trim();
    if (!userId) {
      toast.error('Pick a user or type an email');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/apps/${appId}/shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      });
      const j = (await res.json()) as { grants?: AppGrant[]; error?: string };
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setGrants(j.grants ?? []);
      setQuery('');
      setSelected('');
      setResults([]);
      toast.success(`Shared with ${userId} as ${role}`);
    } catch (e) {
      toast.error(`Share failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId: string) {
    if (!confirm(`Revoke ${userId}'s access to this app?`)) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/v1/admin/apps/${appId}/shares?userId=${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
      );
      const j = (await res.json()) as { grants?: AppGrant[]; error?: string };
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setGrants(j.grants ?? []);
      toast.success(`Revoked ${userId}`);
    } catch (e) {
      toast.error(`Revoke failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Sharing</CardTitle>
        <CardDescription>
          Give people access to this app. Owner{' '}
          <span className="font-mono text-xs">{ownerId || '—'}</span>, org admins, and the owner&apos;s
          management chain (their manager and up) always have access. Grant others directly below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* add-a-share row */}
        <div className="grid gap-3 lg:grid-cols-[1fr_14rem_auto] lg:items-end">
          <div className="space-y-1">
            <Label htmlFor="share-user">Add person</Label>
            <Input
              id="share-user"
              autoComplete="off"
              placeholder={kcConfigured ? 'Search name or email…' : 'Type an email (Keycloak not configured)'}
              value={selected || query}
              onChange={(e) => {
                setSelected('');
                setQuery(e.target.value);
              }}
            />
            {searching ? <p className="text-[11px] text-muted-foreground">Searching…</p> : null}
            {results.length > 0 && !selected ? (
              <div className="max-h-44 overflow-y-auto rounded-md border">
                {results.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setSelected(u.email || u.username);
                      setResults([]);
                    }}
                  >
                    {userLabel(u)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="share-role">Role</Label>
            <select
              id="share-role"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as AppShareRole)}
            >
              {APP_SHARE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r} — {ROLE_HINT[r]}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={addGrant} disabled={busy}>
            {busy ? 'Working…' : 'Share'}
          </Button>
        </div>

        {/* current shares */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium">People with access</h3>
          {grants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No one shared yet — only the owner, admins, and the owner&apos;s management chain have
              access.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {grants.map((g) => (
                <li key={g.userId} className="flex items-center justify-between px-3 py-2">
                  <span className="font-mono text-sm">{g.userId}</span>
                  <span className="flex items-center gap-3">
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">{g.role}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke(g.userId)}
                      disabled={busy}
                    >
                      Revoke
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
