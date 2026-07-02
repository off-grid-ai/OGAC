'use client';

import {
  Check,
  Eye,
  EyeSlash,
  Plus,
  Trash,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface KcRole {
  id: string;
  name: string;
}

interface KcUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  realmRoles?: string[];
}

// ─── Add User form ───────────────────────────────────────────────────────────

function AddUserForm({
  roles,
  onDone,
  onCancel,
}: {
  roles: KcRole[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [temporary, setTemporary] = useState(true);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const toggleRole = (name: string) => {
    setSelectedRoles((prev) =>
      prev.includes(name) ? prev.filter((r) => r !== name) : [...prev, name],
    );
  };

  const submit = async () => {
    if (!email.trim() || !password.trim()) {
      toast.error('Email and password are required.');
      return;
    }
    setSaving(true);
    try {
      const roleObjects = roles.filter((r) => selectedRoles.includes(r.name));
      const res = await fetch('/api/v1/admin/access/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          password,
          temporary,
          roles: roleObjects,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to create user.');
      toast.success('User created.');
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">New user</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          placeholder="Email (required)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          autoFocus
        />
        <Input
          placeholder="Password (required)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
        />
        <Input
          placeholder="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
        <Input
          placeholder="Last name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={temporary}
          onChange={(e) => setTemporary(e.target.checked)}
          className="accent-primary"
        />
        Temporary password — user must change on first login
      </label>
      {roles.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">Assign roles</p>
          <div className="flex flex-wrap gap-1.5">
            {roles.map((r) => {
              const on = selectedRoles.includes(r.name);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleRole(r.name)}
                  className={`rounded border px-2 py-0.5 text-xs font-mono transition-colors ${
                    on
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/60'
                  }`}
                >
                  {on && <Check className="inline-block size-3 mr-1" />}
                  {r.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving ? 'Creating…' : 'Create user'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Expanded row: roles + reset password ────────────────────────────────────

function ExpandedUser({
  user,
  allRoles,
  onRefresh,
}: {
  user: KcUser;
  allRoles: KcRole[];
  onRefresh: () => void;
}) {
  const assigned = new Set(user.realmRoles ?? []);
  const [checked, setChecked] = useState<Set<string>>(new Set(assigned));
  const [savingRoles, setSavingRoles] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [tempPw, setTempPw] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  const toggleChecked = (name: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const saveRoles = async () => {
    setSavingRoles(true);
    try {
      // Determine which to add and which to remove
      const toAdd = allRoles.filter((r) => checked.has(r.name) && !assigned.has(r.name));
      const toRemove = allRoles.filter((r) => !checked.has(r.name) && assigned.has(r.name));

      if (toAdd.length > 0) {
        const res = await fetch(`/api/v1/admin/access/users/${user.id}/roles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roles: toAdd }),
        });
        if (!res.ok) {
          const d = (await res.json()) as { error?: string };
          throw new Error(d.error ?? 'Failed to assign roles.');
        }
      }
      if (toRemove.length > 0) {
        const res = await fetch(`/api/v1/admin/access/users/${user.id}/roles`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roles: toRemove }),
        });
        if (!res.ok) {
          const d = (await res.json()) as { error?: string };
          throw new Error(d.error ?? 'Failed to remove roles.');
        }
      }
      toast.success('Roles updated.');
      onRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingRoles(false);
    }
  };

  const resetPassword = async () => {
    if (!newPassword.trim()) {
      toast.error('Password is required.');
      return;
    }
    setSavingPw(true);
    try {
      const res = await fetch(`/api/v1/admin/access/users/${user.id}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword, temporary: tempPw }),
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to reset password.');
      toast.success('Password reset.');
      setNewPassword('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="space-y-4 py-2">
      {/* Roles */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Realm roles
        </p>
        {allRoles.length === 0 ? (
          <p className="text-xs text-muted-foreground">No realm roles defined.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {allRoles.map((r) => {
              const on = checked.has(r.name);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleChecked(r.name)}
                  className={`rounded border px-2 py-0.5 text-xs font-mono transition-colors ${
                    on
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/60'
                  }`}
                >
                  {on && <Check className="inline-block size-3 mr-1" />}
                  {r.name}
                </button>
              );
            })}
          </div>
        )}
        <Button size="sm" className="mt-2" onClick={saveRoles} disabled={savingRoles}>
          {savingRoles ? 'Saving…' : 'Save roles'}
        </Button>
      </div>

      {/* Reset password */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Reset password
        </p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Input
              type={showPw ? 'text' : 'password'}
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="pr-8 font-mono text-sm w-56"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPw ? <EyeSlash className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={tempPw}
              onChange={(e) => setTempPw(e.target.checked)}
              className="accent-primary"
            />
            Temporary
          </label>
          <Button size="sm" onClick={resetPassword} disabled={savingPw}>
            {savingPw ? 'Resetting…' : 'Reset'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function UsersList() {
  const [users, setUsers] = useState<KcUser[]>([]);
  const [allRoles, setAllRoles] = useState<KcRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchUsers = useCallback(async (q?: string) => {
    setLoading(true);
    setApiError(null);
    try {
      const url = new URL('/api/v1/admin/access/users', window.location.origin);
      if (q) url.searchParams.set('search', q);
      const res = await fetch(url.toString());
      const data = (await res.json()) as { users?: KcUser[]; error?: string };
      if (!res.ok) {
        setApiError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setUsers(data.users ?? []);
    } catch {
      setApiError('Failed to reach the access API.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRoles = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/access/roles');
      const data = (await res.json()) as { roles?: KcRole[] };
      setAllRoles(data.roles ?? []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
    void fetchRoles();
  }, [fetchUsers, fetchRoles]);

  const onSearchChange = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchUsers(val), 400);
  };

  const deleteUser = async (user: KcUser) => {
    const label = user.email ?? user.username;
    if (!window.confirm(`Delete user ${label}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/v1/admin/access/users/${user.id}`, { method: 'DELETE' });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to delete user.');
      toast.success(`Deleted ${label}.`);
      void fetchUsers(search);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <UsersThree className="size-4 text-primary" />
          Users
        </CardTitle>
        <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="size-3.5 mr-1" />
          Add user
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAdd && (
          <AddUserForm
            roles={allRoles}
            onDone={() => {
              setShowAdd(false);
              void fetchUsers(search);
            }}
            onCancel={() => setShowAdd(false)}
          />
        )}

        <Input
          placeholder="Search users…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="max-w-xs"
        />

        {apiError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
            <span className="font-medium">Keycloak error:</span> {apiError}
            {apiError === 'forbidden' && (
              <span className="ml-1 text-muted-foreground">
                — the service account needs the <code className="rounded bg-muted px-1">view-users</code> role under realm-management in Keycloak.
              </span>
            )}
          </div>
        )}

        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((u) => {
                    const isOpen = expandedId === u.id;
                    return (
                      <>
                        <TableRow
                          key={u.id}
                          className="cursor-pointer"
                          onClick={() => setExpandedId(isOpen ? null : u.id)}
                        >
                          <TableCell className="font-mono text-xs">
                            {isOpen ? '▾ ' : '▸ '}
                            {u.email ?? u.username}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant={u.enabled ? 'default' : 'destructive'} className="text-xs">
                              {u.enabled ? 'enabled' : 'disabled'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(u.realmRoles ?? []).map((r) => (
                                <Badge key={r} variant="secondary" className="font-mono text-xs">
                                  {r}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                void deleteUser(u);
                              }}
                              title="Delete user"
                            >
                              <Trash className="size-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow key={`${u.id}-expanded`}>
                            <TableCell colSpan={5} className="bg-muted/30">
                              <ExpandedUser
                                user={u}
                                allRoles={allRoles}
                                onRefresh={() => fetchUsers(search)}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
