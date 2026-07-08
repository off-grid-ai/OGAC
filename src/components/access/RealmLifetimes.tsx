'use client';

import { Clock } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingBlock, Spinner } from '@/components/ui/spinner';

interface Lifetimes {
  realm: string;
  accessTokenLifespan?: number;
  ssoSessionIdleTimeout?: number;
  ssoSessionMaxLifespan?: number;
  accessTokenLifespanForImplicitFlow?: number;
  offlineSessionIdleTimeout?: number;
  actionTokenGeneratedByUserLifespan?: number;
}

// The editable lifetime fields, with human labels. Values are seconds.
const FIELDS: { key: keyof Lifetimes; label: string; help: string }[] = [
  { key: 'accessTokenLifespan', label: 'Access token lifespan', help: 'How long an access token is valid.' },
  { key: 'ssoSessionIdleTimeout', label: 'SSO session idle', help: 'Idle time before an SSO session expires.' },
  { key: 'ssoSessionMaxLifespan', label: 'SSO session max', help: 'Max lifetime of an SSO session.' },
  {
    key: 'accessTokenLifespanForImplicitFlow',
    label: 'Access token (implicit flow)',
    help: 'Access token lifespan for the implicit flow.',
  },
  { key: 'offlineSessionIdleTimeout', label: 'Offline session idle', help: 'Idle time before an offline session expires.' },
  {
    key: 'actionTokenGeneratedByUserLifespan',
    label: 'User action token lifespan',
    help: 'Lifetime of user-generated action tokens (e.g. reset password).',
  },
];

function fmt(seconds: number | undefined): string {
  if (seconds === undefined || seconds < 0) return '—';
  if (seconds === 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' ');
}

// Token/session lifetimes tab. Reads the realm's lifetime settings and edits the key ones. The server
// merges the patch into the full realm rep (never clobbers) before PUTting back.
export function RealmLifetimes() {
  const [data, setData] = useState<Lifetimes | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/access/realm');
      const body = (await res.json()) as { lifetimes?: Lifetimes; error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setData(body.lifetimes ?? null);
      const d: Record<string, string> = {};
      for (const f of FIELDS) {
        const v = body.lifetimes?.[f.key];
        if (typeof v === 'number') d[f.key] = String(v);
      }
      setDraft(d);
    } catch {
      setError('Failed to reach the access API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const patch: Record<string, number> = {};
    for (const f of FIELDS) {
      const raw = draft[f.key];
      if (raw === undefined || raw.trim() === '') continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        toast.error(`${f.label} must be a non-negative whole number of seconds.`);
        return;
      }
      patch[f.key] = n;
    }
    if (Object.keys(patch).length === 0) {
      toast.error('Nothing to update.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/v1/admin/access/realm', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = (await res.json()) as { lifetimes?: Lifetimes; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to update lifetimes.');
      toast.success('Realm lifetimes updated.');
      setData(body.lifetimes ?? null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Clock className="size-4 text-primary" />
          Token &amp; session lifetimes
          {data?.realm && (
            <span className="ml-1 font-mono text-xs text-muted-foreground">({data.realm})</span>
          )}
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
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              All values are in seconds. Leave a field blank to keep its current value. The rest of
              the realm configuration is preserved on save.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <label className="text-xs font-medium text-foreground">{f.label}</label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={draft[f.key] ?? ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    {f.help}{' '}
                    <span className="font-mono">
                      current: {fmt(typeof data?.[f.key] === 'number' ? (data[f.key] as number) : undefined)}
                    </span>
                  </p>
                </div>
              ))}
            </div>
            <Button size="sm" className="gap-1.5" onClick={save} disabled={saving}>
              {saving ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : (
                'Save lifetimes'
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
