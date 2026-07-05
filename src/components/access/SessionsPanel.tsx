'use client';

import { Monitor, SignOut, Trash } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { UserPicker, type PickableUser } from '@/components/access/UserPicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Session {
  id: string;
  username: string;
  ipAddress: string;
  start: number;
  lastAccess: number;
  clients: string[];
}

function fmt(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

// Active-sessions tab. Selection of the target user lives in the URL (?user=<id>) so Back is coherent
// and the view is deep-linkable.
export function SessionsPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const userId = params.get('user');

  const [label, setLabel] = useState<string>('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectUser = (u: PickableUser) => {
    setLabel(u.email ?? u.username);
    const next = new URLSearchParams(params.toString());
    next.set('user', u.id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const fetchSessions = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/access/users/${id}/sessions`);
      const data = (await res.json()) as { sessions?: Session[]; error?: string };
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
  }, []);

  useEffect(() => {
    if (userId) void fetchSessions(userId);
    else setSessions([]);
  }, [userId, fetchSessions]);

  const revoke = async (sessionId: string) => {
    if (!window.confirm('Revoke this session? The device will be signed out.')) return;
    try {
      const res = await fetch(`/api/v1/admin/access/sessions/${sessionId}`, { method: 'DELETE' });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to revoke session.');
      toast.success('Session revoked.');
      if (userId) void fetchSessions(userId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const logoutAll = async () => {
    if (!userId) return;
    if (!window.confirm(`Sign ${label || 'this user'} out of ALL sessions?`)) return;
    try {
      const res = await fetch(`/api/v1/admin/access/users/${userId}/sessions`, { method: 'DELETE' });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to log out user.');
      toast.success('User logged out of all sessions.');
      void fetchSessions(userId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Monitor className="size-4 text-primary" />
          Active sessions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <UserPicker selectedId={userId} onSelect={selectUser} />

        {!userId ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Select a user to view their active sessions.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Sessions for <span className="font-mono text-foreground">{label || userId}</span>
              </p>
              <Button size="sm" variant="destructive" onClick={logoutAll} disabled={loading}>
                <SignOut className="size-3.5 mr-1" />
                Log out everywhere
              </Button>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
                <span className="font-medium">Keycloak error:</span> {error}
              </div>
            )}

            {loading ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP address</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Last access</TableHead>
                      <TableHead>Clients</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                          No active sessions.
                        </TableCell>
                      </TableRow>
                    ) : (
                      sessions.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-mono text-xs">{s.ipAddress || '—'}</TableCell>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
