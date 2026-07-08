'use client';

import { ShieldCheck, ShieldWarning, Trash } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { UserPicker, type PickableUser } from '@/components/access/UserPicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingBlock } from '@/components/ui/spinner';

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
interface RequiredAction {
  alias: string;
  name: string;
  enabled: boolean;
  defaultAction: boolean;
}

// MFA tab: per-user OTP enablement + the realm's required-action policy (read-only). User selection
// lives in the URL (?user=<id>).
export function MfaPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const userId = params.get('user');

  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [requiredActions, setRequiredActions] = useState<string[]>([]);
  const [policy, setPolicy] = useState<RequiredAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectUser = (u: PickableUser) => {
    setLabel(u.email ?? u.username);
    const next = new URLSearchParams(params.toString());
    next.set('user', u.id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const fetchStatus = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/access/users/${id}/mfa`);
      const data = (await res.json()) as {
        mfa?: MfaStatus;
        requiredActions?: string[];
        error?: string;
      };
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
  }, []);

  const fetchPolicy = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/access/required-actions');
      const data = (await res.json()) as { requiredActions?: RequiredAction[] };
      setPolicy(data.requiredActions ?? []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    void fetchPolicy();
  }, [fetchPolicy]);

  useEffect(() => {
    if (userId) void fetchStatus(userId);
    else {
      setStatus(null);
      setRequiredActions([]);
    }
  }, [userId, fetchStatus]);

  const otpPending = requiredActions.includes('CONFIGURE_TOTP');

  const requireOtp = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/access/users/${userId}/mfa`, { method: 'POST' });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to require OTP.');
      toast.success('User will be prompted to configure OTP on next login.');
      void fetchStatus(userId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unrequireOtp = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/access/users/${userId}/mfa`, { method: 'DELETE' });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to clear OTP requirement.');
      toast.success('Removed the pending OTP requirement.');
      void fetchStatus(userId);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeCredential = async (credId: string) => {
    if (!userId) return;
    if (!window.confirm('Remove this credential? The user may lose MFA access.')) return;
    try {
      const res = await fetch(
        `/api/v1/admin/access/users/${userId}/mfa?credentialId=${encodeURIComponent(credId)}`,
        { method: 'DELETE' },
      );
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to remove credential.');
      toast.success('Credential removed.');
      void fetchStatus(userId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="size-4 text-primary" />
            Multi-factor authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <UserPicker selectedId={userId} onSelect={selectUser} />

          {!userId ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Select a user to view and manage their MFA.
            </p>
          ) : error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
              <span className="font-medium">Identity provider error:</span> {error}
            </div>
          ) : loading ? (
            <LoadingBlock />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono text-foreground">{label || userId}</span> —
                </span>
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
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Realm required-action policy</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Read-only. Realm-wide default required actions are set in your identity provider's admin console
            (Authentication → Required actions). Per-user OTP enablement is done above.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {policy.length === 0 ? (
              <span className="text-xs text-muted-foreground">None reported.</span>
            ) : (
              policy.map((a) => (
                <Badge
                  key={a.alias}
                  variant={a.enabled ? 'default' : 'secondary'}
                  className="text-xs"
                >
                  {a.name}
                  {a.defaultAction && ' (default)'}
                  {!a.enabled && ' (disabled)'}
                </Badge>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
