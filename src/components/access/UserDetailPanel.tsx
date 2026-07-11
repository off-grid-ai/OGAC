'use client';

import {
  Check,
  Eye,
  EyeSlash,
  Monitor,
  ShieldCheck,
  ShieldWarning,
  SignOut,
  Trash,
} from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingBlock, Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { diffRoles, userDisplayName, userSubtitle } from '@/lib/user-detail';

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
  emailVerified?: boolean;
  realmRoles?: string[];
}
interface Session {
  id: string;
  username: string;
  ipAddress: string;
  start: number;
  lastAccess: number;
  clients: string[];
  offline: boolean;
}
interface Credential {
  id: string;
  type: string;
  label: string;
  createdDate?: number;
}
interface MfaStatus {
  otpConfigured: boolean;
  credentials: Credential[];
}

function fmt(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

// A degraded-call banner: Keycloak 403 (missing realm-management grant) or an unreachable service.
// Mirrors the honest messaging used by the Sessions / Federation panels — never a 500 dead-end.
function DegradeBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
      <span className="font-medium">Identity provider error:</span> {message}
    </div>
  );
}

// ─── Roles card ──────────────────────────────────────────────────────────────

function RolesCard({
  userId,
  assigned,
  allRoles,
  onChanged,
}: {
  userId: string;
  assigned: string[];
  allRoles: KcRole[];
  onChanged: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set(assigned));
  const [saving, setSaving] = useState(false);

  // Re-sync the local checkbox state when the parent refetches (assigned changes identity).
  useEffect(() => {
    setChecked(new Set(assigned));
  }, [assigned]);

  const toggle = (name: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const { toAdd, toRemove } = diffRoles(allRoles, assigned, checked);
      if (toAdd.length > 0) {
        const res = await fetch(`/api/v1/admin/access/users/${userId}/roles`, {
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
        const res = await fetch(`/api/v1/admin/access/users/${userId}/roles`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roles: toRemove }),
        });
        if (!res.ok) {
          const d = (await res.json()) as { error?: string };
          throw new Error(d.error ?? 'Failed to remove roles.');
        }
      }
      if (toAdd.length === 0 && toRemove.length === 0) {
        toast.info('No role changes to save.');
      } else {
        toast.success('Roles updated.');
      }
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Realm roles</CardTitle>
        <p className="text-xs text-muted-foreground">Toggle the roles assigned to this user.</p>
      </CardHeader>
      <CardContent className="space-y-3">
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
                  onClick={() => toggle(r.name)}
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
        <Button size="sm" className="gap-1.5" onClick={save} disabled={saving || allRoles.length === 0}>
          {saving ? (
            <>
              <Spinner /> Saving…
            </>
          ) : (
            'Save roles'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Password card ─────────────────────────────────────────────────────────────

function PasswordCard({ userId }: { userId: string }) {
  const [newPassword, setNewPassword] = useState('');
  const [tempPw, setTempPw] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = async () => {
    if (!newPassword.trim()) {
      toast.error('Password is required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/access/users/${userId}/password`, {
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
      setSaving(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Reset password</CardTitle>
        <p className="text-xs text-muted-foreground">Set a new password for this user.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
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
            <span>Temporary</span>
          </label>
          <Button size="sm" className="gap-1.5" onClick={reset} disabled={saving}>
            {saving ? (
              <>
                <Spinner /> Resetting…
              </>
            ) : (
              'Reset'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── MFA card ──────────────────────────────────────────────────────────────────

function MfaCard({ userId }: { userId: string }) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [requiredActions, setRequiredActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/access/users/${userId}/mfa`);
      const data = (await res.json()) as {
        mfa?: MfaStatus;
        requiredActions?: string[];
        error?: string;
        configured?: boolean;
      };
      if (data.configured === false) {
        setError('Identity provider is not configured.');
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setStatus(data.mfa ?? null);
      setRequiredActions(data.requiredActions ?? []);
    } catch {
      setError('Failed to reach the access API.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const otpPending = requiredActions.includes('CONFIGURE_TOTP');

  const requireOtp = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/access/users/${userId}/mfa`, { method: 'POST' });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to require OTP.');
      toast.success('User will be prompted to configure OTP on next login.');
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unrequireOtp = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/access/users/${userId}/mfa`, { method: 'DELETE' });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to clear OTP requirement.');
      toast.success('Removed the pending OTP requirement.');
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeCredential = async (credId: string) => {
    if (!window.confirm('Remove this credential? The user may lose MFA access.')) return;
    try {
      const res = await fetch(
        `/api/v1/admin/access/users/${userId}/mfa?credentialId=${encodeURIComponent(credId)}`,
        { method: 'DELETE' },
      );
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to remove credential.');
      toast.success('Credential removed.');
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-4 text-primary" />
          Multi-factor authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <DegradeBanner message={error} />
        ) : loading ? (
          <LoadingBlock />
        ) : (
          <>
            <div className="flex items-center gap-2">
              {status?.otpConfigured ? (
                <Badge variant="default" className="text-xs">
                  <ShieldCheck className="size-3 mr-1" /> OTP configured
                </Badge>
              ) : otpPending ? (
                <Badge variant="secondary" className="text-xs">
                  <ShieldWarning className="size-3 mr-1" /> OTP setup pending
                </Badge>
              ) : (
                <Badge variant="destructive" className="text-xs">
                  <ShieldWarning className="size-3 mr-1" /> No OTP
                </Badge>
              )}
            </div>

            <div className="flex gap-2">
              {!status?.otpConfigured && !otpPending && (
                <Button size="sm" onClick={requireOtp} disabled={busy}>
                  Require OTP setup
                </Button>
              )}
              {otpPending && (
                <Button size="sm" variant="ghost" onClick={unrequireOtp} disabled={busy}>
                  Cancel OTP requirement
                </Button>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Credentials
              </p>
              {(status?.credentials ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No credentials.</p>
              ) : (
                <div className="space-y-1.5">
                  {status?.credentials.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded border border-border px-3 py-1.5"
                    >
                      <span className="font-mono text-xs">
                        {c.label}
                        <Badge variant="secondary" className="ml-2 text-xs">
                          {c.type}
                        </Badge>
                      </span>
                      {c.type !== 'password' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void removeCredential(c.id)}
                          title="Remove credential"
                        >
                          <Trash className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sessions card (scoped to this user) ────────────────────────────────────────

function SessionsCard({ userId, label }: { userId: string; label: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/access/users/${userId}/sessions`);
      const data = (await res.json()) as {
        sessions?: Session[];
        error?: string;
        configured?: boolean;
      };
      if (data.configured === false) {
        setError('Identity provider is not configured.');
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSessions(data.sessions ?? []);
    } catch {
      setError('Failed to reach the access API.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (sessionId: string) => {
    if (!window.confirm('Revoke this session? The device will be signed out.')) return;
    try {
      const res = await fetch(`/api/v1/admin/access/sessions/${sessionId}`, { method: 'DELETE' });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to revoke session.');
      toast.success('Session revoked.');
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const logoutAll = async () => {
    if (!window.confirm(`Sign ${label} out of ALL sessions?`)) return;
    try {
      const res = await fetch(`/api/v1/admin/access/users/${userId}/sessions`, {
        method: 'DELETE',
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to log out user.');
      toast.success('User logged out of all sessions.');
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card className="shadow-sm lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Monitor className="size-4 text-primary" />
          Active sessions
        </CardTitle>
        <Button size="sm" variant="destructive" onClick={logoutAll} disabled={loading || !!error}>
          <SignOut className="size-3.5 mr-1" />
          Log out everywhere
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <DegradeBanner message={error} />
        ) : loading ? (
          <LoadingBlock />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP address</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Last access</TableHead>
                  <TableHead>Clients</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-6 text-center text-xs text-muted-foreground"
                    >
                      No active sessions for this user. The console signs in with
                      short-lived direct-grant tokens, so an idle online session may have already
                      expired even though the operator is still signed in.
                    </TableCell>
                  </TableRow>
                ) : (
                  sessions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.ipAddress || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={s.offline ? 'secondary' : 'default'} className="text-xs">
                          {s.offline ? 'offline' : 'online'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmt(s.start)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmt(s.lastAccess)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {s.clients.map((c) => (
                            <Badge key={c} variant="secondary" className="font-mono text-xs">
                              {c}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void revoke(s.id)}
                          title="Revoke session"
                        >
                          <Trash className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function UserDetailPanel({ userId }: { userId: string }) {
  const [user, setUser] = useState<KcUser | null>(null);
  const [allRoles, setAllRoles] = useState<KcRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const loadUser = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/v1/admin/access/users/${userId}`);
      const data = (await res.json()) as {
        user?: KcUser;
        error?: string;
        configured?: boolean;
      };
      if (data.configured === false) {
        setError('Identity provider is not configured.');
        return;
      }
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setUser(data.user ?? null);
    } catch {
      setError('Failed to reach the access API.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const loadRoles = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/access/roles');
      const data = (await res.json()) as { roles?: KcRole[] };
      setAllRoles(data.roles ?? []);
    } catch {
      /* silent — roles card degrades to "no roles" */
    }
  }, []);

  useEffect(() => {
    void loadUser();
    void loadRoles();
  }, [loadUser, loadRoles]);

  if (loading) {
    return <LoadingBlock label="Loading user…" />;
  }

  if (error) {
    return (
      <DegradeBanner
        message={
          error === 'forbidden'
            ? 'forbidden — the service account needs the view-users / manage-users roles under realm-management in your identity provider.'
            : error
        }
      />
    );
  }

  if (notFound || !user) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
        User not found. It may have been deleted.
      </div>
    );
  }

  const name = userDisplayName(user);
  const subtitle = userSubtitle(user);
  const facts = [
    { label: 'Username', value: user.username || '—' },
    { label: 'Email', value: user.email || '—' },
    { label: 'Email verified', value: user.emailVerified ? 'yes' : 'no' },
    { label: 'Status', value: user.enabled ? 'enabled' : 'disabled' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">{name}</h1>
            <Badge variant={user.enabled ? 'default' : 'destructive'} className="text-xs">
              {user.enabled ? 'enabled' : 'disabled'}
            </Badge>
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{subtitle}</p>
          <p className="font-mono text-[10px] text-muted-foreground/70">{user.id}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {facts.map((f) => (
          <Card key={f.label} className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                {f.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="truncate text-sm font-medium text-foreground">
              {f.value}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RolesCard
          userId={user.id}
          assigned={user.realmRoles ?? []}
          allRoles={allRoles}
          onChanged={loadUser}
        />
        <PasswordCard userId={user.id} />
        <MfaCard userId={user.id} />
        <SessionsCard userId={user.id} label={name} />
      </div>
    </div>
  );
}
