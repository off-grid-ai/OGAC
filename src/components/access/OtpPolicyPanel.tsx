'use client';

import { ShieldPlus } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingBlock, Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';

// Kept in sync with the pure catalogs in src/lib/keycloak-federation.ts (validated server-side there).
const TYPES = ['totp', 'hotp'] as const;
const ALGORITHMS = ['HmacSHA1', 'HmacSHA256', 'HmacSHA512'] as const;
const DIGITS = [6, 8] as const;

interface OtpPolicy {
  type: (typeof TYPES)[number];
  algorithm: (typeof ALGORITHMS)[number];
  digits: (typeof DIGITS)[number];
  period: number;
  initialCounter: number;
  lookAheadWindow: number;
  codeReusable: boolean;
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

// Realm-wide MFA / OTP policy — the strength EVERY user's authenticator must meet. The server merges
// the patch into the full realm rep (never clobbers the rest of the realm config) before PUTting back.
export function OtpPolicyPanel() {
  const [policy, setPolicy] = useState<OtpPolicy | null>(null);
  const [draft, setDraft] = useState<OtpPolicy | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/access/mfa/policy');
      const body = (await res.json()) as { policy?: OtpPolicy; summary?: string; error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setPolicy(body.policy ?? null);
      setDraft(body.policy ?? null);
      setSummary(body.summary ?? '');
    } catch {
      setError('Failed to reach the access API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof OtpPolicy>(key: K, value: OtpPolicy[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch('/api/v1/admin/access/mfa/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const body = (await res.json()) as { policy?: OtpPolicy; summary?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to update OTP policy.');
      toast.success('OTP policy updated. New enrolments use the stronger settings.');
      setPolicy(body.policy ?? null);
      setDraft(body.policy ?? null);
      setSummary(body.summary ?? '');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    !!draft && !!policy && (Object.keys(draft) as (keyof OtpPolicy)[]).some((k) => draft[k] !== policy[k]);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldPlus className="size-4 text-primary" />
          OTP policy (realm-wide MFA strength)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
            <span className="font-medium">Identity provider error:</span> {error}
          </div>
        )}

        {loading ? (
          <LoadingBlock />
        ) : draft ? (
          <>
            <p className="text-xs text-muted-foreground">
              Sets how strong every user&apos;s one-time-password authenticator must be. Applies to new
              OTP enrolments. The rest of the realm configuration is preserved on save.
              {summary && (
                <>
                  {' '}
                  <span className="font-mono text-foreground">Current: {summary}.</span>
                </>
              )}
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground" htmlFor="otp-type">
                  Type
                </label>
                <select
                  id="otp-type"
                  className={selectClass}
                  value={draft.type}
                  onChange={(e) => set('type', e.target.value as OtpPolicy['type'])}
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t === 'totp' ? 'TOTP (time-based)' : 'HOTP (counter-based)'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground" htmlFor="otp-alg">
                  Hash algorithm
                </label>
                <select
                  id="otp-alg"
                  className={selectClass}
                  value={draft.algorithm}
                  onChange={(e) => set('algorithm', e.target.value as OtpPolicy['algorithm'])}
                >
                  {ALGORITHMS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground" htmlFor="otp-digits">
                  Digits
                </label>
                <select
                  id="otp-digits"
                  className={selectClass}
                  value={draft.digits}
                  onChange={(e) => set('digits', Number(e.target.value) as OtpPolicy['digits'])}
                >
                  {DIGITS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              {draft.type === 'totp' ? (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground" htmlFor="otp-period">
                    Time window (seconds)
                  </label>
                  <Input
                    id="otp-period"
                    type="number"
                    min={1}
                    step={1}
                    className="font-mono text-sm"
                    value={draft.period}
                    onChange={(e) => set('period', Number(e.target.value))}
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground" htmlFor="otp-counter">
                    Initial counter
                  </label>
                  <Input
                    id="otp-counter"
                    type="number"
                    min={0}
                    step={1}
                    className="font-mono text-sm"
                    value={draft.initialCounter}
                    onChange={(e) => set('initialCounter', Number(e.target.value))}
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground" htmlFor="otp-window">
                  Look-ahead window
                </label>
                <Input
                  id="otp-window"
                  type="number"
                  min={1}
                  step={1}
                  className="font-mono text-sm"
                  value={draft.lookAheadWindow}
                  onChange={(e) => set('lookAheadWindow', Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Drift tolerance (steps accepted).</p>
              </div>

              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-foreground">Allow code reuse</p>
                  <p className="text-xs text-muted-foreground">Weaker — keep off for BFSI.</p>
                </div>
                <Switch
                  checked={draft.codeReusable}
                  onCheckedChange={(v) => set('codeReusable', v)}
                  aria-label="Allow code reuse"
                />
              </div>
            </div>

            <Button size="sm" className="gap-1.5" onClick={save} disabled={saving || !dirty}>
              {saving ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : (
                'Save OTP policy'
              )}
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
