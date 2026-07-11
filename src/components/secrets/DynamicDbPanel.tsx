'use client';

import { Copy, Database, Lightning } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type DynamicDbCreds, formatTtl } from '@/lib/secrets-ops';

// Dynamic DATABASE secrets. Enumerates the roles configured on the `database` secrets engine and
// generates on-demand, short-lived creds for a role. The minted username/password ARE shown once —
// that is the point of a dynamic secret — with the lease + TTL so the operator knows when it expires.
// If the engine isn't provisioned, the panel says so (stubbed path, per task scope note).
export function DynamicDbPanel({ sealed }: Readonly<{ sealed: boolean }>) {
  const [roles, setRoles] = useState<string[]>([]);
  const [mount, setMount] = useState('database');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ role: string; creds: DynamicDbCreds } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/secrets/dynamic-db');
      const d = (await res.json()) as { roles?: string[]; mount?: string };
      setRoles(Array.isArray(d.roles) ? d.roles.filter((r) => !r.endsWith('/')) : []);
      if (d.mount) setMount(d.mount);
    } catch {
      // engine absent / unreachable — treat as no roles
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async (role: string) => {
    setBusy(role);
    try {
      const res = await fetch('/api/v1/admin/secrets/dynamic-db', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const d = (await res.json()) as { creds?: DynamicDbCreds; error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed to generate creds.');
      if (d.creds) setCreds({ role, creds: d.creds });
      toast.success(`Generated dynamic creds for "${role}".`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
    toast.success('Copied to clipboard.');
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="size-4 text-muted-foreground" />
          Dynamic database secrets
          <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
            {mount}/
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Loading roles…</p>
        ) : roles.length === 0 ? (
          <p className="rounded-md border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
            The <span className="font-mono">{mount}</span> secrets engine has no roles (or isn&apos;t
            enabled). Enable it and configure a role against a connection to generate on-demand,
            short-lived DB credentials here. Set{' '}
            <span className="font-mono">OFFGRID_OPENBAO_DB_MOUNT</span> if the engine is mounted
            elsewhere.
          </p>
        ) : (
          <div className="space-y-2">
            {roles.map((role) => (
              <div
                key={role}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <span className="font-mono text-xs text-foreground">{role}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={sealed || busy !== null}
                  onClick={() => void generate(role)}
                >
                  <Lightning className="mr-1 size-3.5" />
                  {busy === role ? 'Generating…' : 'Generate creds'}
                </Button>
              </div>
            ))}
          </div>
        )}

        {creds && (
          <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-primary">
                Dynamic creds for {creds.role} — shown once
              </span>
              <span className="text-[10px] text-muted-foreground">
                lease {creds.creds.leaseId ?? '—'} · TTL {formatTtl(creds.creds.leaseDuration)}
              </span>
            </div>
            <CredField label="username" value={creds.creds.username} onCopy={copy} />
            <CredField label="password" value={creds.creds.password} onCopy={copy} />
            <Button size="sm" variant="ghost" onClick={() => setCreds(null)}>
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CredField({
  label,
  value,
  onCopy,
}: Readonly<{
  label: string;
  value: string | null;
  onCopy: (text: string) => void;
}>) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <code className="flex-1 truncate rounded bg-background px-2 py-1 font-mono text-xs">
        {value ?? '—'}
      </code>
      {value && (
        <Button size="sm" variant="ghost" onClick={() => onCopy(value)} title={`Copy ${label}`}>
          <Copy className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
