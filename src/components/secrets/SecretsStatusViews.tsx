import {
  Cube,
  Key,
  LockKey,
  LockKeyOpen,
  ShieldCheck,
  Stack,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatRail } from '@/components/ui/StatRail';
import type { SecretsView } from '@/lib/secrets-view';

export function SecretsStatusBanner({
  view,
  error,
}: Readonly<{ view: SecretsView; error: string | null }>) {
  if (!view.configured) {
    return (
      <Card className="shadow-sm">
        <CardContent className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
          <Warning className="size-5 shrink-0" />
          <span>
            The secrets store is not configured. Set{' '}
            <span className="font-mono">OFFGRID_OPENBAO_URL</span> to enable the KMS-backed secrets
            store. The console falls back to the{' '}
            <span className="font-mono">{view.activeAdapterVendor}</span> adapter.
          </span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40 bg-destructive/5 shadow-sm">
        <CardContent className="flex items-center gap-3 py-4 text-sm text-foreground">
          <Warning className="size-5 shrink-0 text-destructive" />
          <span>
            <span className="font-semibold text-destructive">Secrets store unreachable.</span>{' '}
            {error}
          </span>
        </CardContent>
      </Card>
    );
  }

  if (view.sealed === true) {
    return (
      <Card className="border-destructive/40 bg-destructive/5 shadow-sm">
        <CardContent className="flex items-center gap-3 py-4 text-sm text-foreground">
          <LockKey className="size-5 shrink-0 text-destructive" />
          <span>
            <span className="font-semibold text-destructive">Vault is sealed.</span> Secrets cannot
            be read or written until it is unsealed
            {view.unsealThreshold !== null && view.unsealShares !== null
              ? ` (${view.unsealProgress ?? 0}/${view.unsealThreshold} of ${view.unsealShares} key shares provided)`
              : ''}
            .
          </span>
        </CardContent>
      </Card>
    );
  }

  return null;
}

export function SecretsSummary({ view }: Readonly<{ view: SecretsView }>) {
  const sealed = view.sealed === true;
  const unsealed = view.sealed === false;
  const sealStatus = sealed ? 'Sealed' : unsealed ? 'Unsealed' : 'Unknown';
  const sealTone = sealed ? 'bad' : unsealed ? 'good' : 'muted';

  return (
    <StatRail cols={4}>
      <SummaryTile
        icon={<ShieldCheck className="size-4" />}
        label="Reachable"
        value={view.reachable ? 'Yes' : 'No'}
        tone={view.reachable ? 'good' : 'bad'}
        sub={view.baoUrl ?? (view.configured ? 'no response' : 'not configured')}
      />
      <SummaryTile
        icon={unsealed ? <LockKeyOpen className="size-4" /> : <LockKey className="size-4" />}
        label="Seal status"
        value={sealStatus}
        tone={sealTone}
        sub={
          view.unsealShares !== null && view.unsealThreshold !== null
            ? `threshold ${view.unsealThreshold} of ${view.unsealShares}`
            : 'seal config unknown'
        }
      />
      <SummaryTile
        icon={<Key className="size-4" />}
        label="Active adapter"
        value={view.activeAdapterVendor}
        tone="muted"
        sub={view.configured ? 'KMS-backed' : 'fallback'}
      />
      <SummaryTile
        icon={<Cube className="size-4" />}
        label="Version"
        value={view.version ?? '—'}
        tone="muted"
        sub={view.clusterName ?? (view.standby === true ? 'standby node' : 'active node')}
      />
    </StatRail>
  );
}

export function SecretsMountTable({ view }: Readonly<{ view: SecretsView }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Stack className="size-4 text-muted-foreground" />
            Secret engine mounts
          </CardTitle>
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            {view.mounts.length} mount{view.mounts.length === 1 ? '' : 's'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {view.mounts.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {view.reachable
              ? 'No mount table returned (a token with sys/mounts read access is required).'
              : 'Mount table unavailable — the secrets store did not respond.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 font-medium">Path</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {view.mounts.map((mount) => (
                  <tr key={mount.path} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-4 font-mono text-foreground">{mount.path}</td>
                    <td className="py-2 pr-4">
                      <Badge variant="outline" className="text-muted-foreground">
                        {mount.type}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{mount.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  sub,
  tone,
}: Readonly<{
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: 'good' | 'bad' | 'muted';
}>) {
  const toneClass = {
    good: 'text-primary',
    bad: 'text-destructive',
    muted: 'text-foreground',
  }[tone];

  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-1 py-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-[10px] uppercase tracking-wide">{label}</span>
        </div>
        <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
        <div className="truncate font-mono text-[10px] text-muted-foreground/70" title={sub}>
          {sub}
        </div>
      </CardContent>
    </Card>
  );
}
