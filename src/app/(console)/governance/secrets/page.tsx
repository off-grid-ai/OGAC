import {
  Cube,
  Key,
  LockKey,
  LockKeyOpen,
  ShieldCheck,
  Stack,
  Vault,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import { DynamicDbPanel } from '@/components/secrets/DynamicDbPanel';
import { LeasesPanel } from '@/components/secrets/LeasesPanel';
import { SealControl } from '@/components/secrets/SealControl';
import { SecretsManagerNav } from '@/components/secrets/SecretsManagerNav';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatRail } from '@/components/ui/StatRail';
import { requireModuleForUser } from '@/lib/module-access';
import { readSecretsView } from '@/lib/secrets-view';

export const dynamic = 'force-dynamic';

// Secrets MANAGEMENT surface. Shows OpenBao reachability, seal status, active adapter, and the mount
// table (status/metadata only, from /sys/* endpoints), then a full key-CRUD manager: list key NAMES,
// write (value is write-only), delete. A secret VALUE is never read or rendered anywhere on this
// page — status comes from sys endpoints, and the manager's GET returns key names only.
export default async function SecretsPage() {
  // Reuses the 'control' module gate (no dedicated secrets module in the registry).
  await requireModuleForUser('secrets');
  const { data: view, error } = await readSecretsView();

  const sealed = view.sealed === true;
  const unsealed = view.sealed === false;

  let sealStatusValue = 'Unknown';
  let sealStatusTone: 'good' | 'bad' | 'muted' = 'muted';
  if (sealed) {
    sealStatusValue = 'Sealed';
    sealStatusTone = 'bad';
  } else if (unsealed) {
    sealStatusValue = 'Unsealed';
    sealStatusTone = 'good';
  }

  let statusBanner: React.ReactNode = null;
  if (!view.configured) {
    statusBanner = (
      <Card className="shadow-sm">
        <CardContent className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
          <Warning className="size-5 shrink-0 text-muted-foreground" />
          <span>
            The secrets store is not configured. Set{' '}
            <span className="font-mono">OFFGRID_OPENBAO_URL</span> to enable the KMS-backed secrets
            store. The console falls back to the{' '}
            <span className="font-mono">{view.activeAdapterVendor}</span> adapter.
          </span>
        </CardContent>
      </Card>
    );
  } else if (error) {
    statusBanner = (
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
  } else if (sealed) {
    statusBanner = (
      <Card className="border-destructive/40 bg-destructive/5 shadow-sm">
        <CardContent className="flex items-center gap-3 py-4 text-sm text-foreground">
          <LockKey className="size-5 shrink-0 text-destructive" />
          <span>
            <span className="font-semibold text-destructive">Vault is SEALED.</span> Secrets cannot
            be read or written until it is unsealed
            {view.unsealThreshold !== null && view.unsealShares !== null
              ? ` (${view.unsealProgress ?? 0}/${view.unsealThreshold} of ${view.unsealShares} key shares provided)`
              : ''}
            . Unsealing requires operator key shares and is performed against the secrets store
            directly — not from this browser.
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Vault className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Secrets</h1>
          <p className="text-sm text-muted-foreground">
            Manage the on-prem secrets store — seal state, active adapter, mount paths, and full key
            CRUD. Secret values are write-only: never read back or shown here.
          </p>
        </div>
      </div>

      {statusBanner}

      {/* Summary tiles — horizontal rail on mobile, restored 4-col grid on desktop. */}
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
          value={sealStatusValue}
          tone={sealStatusTone}
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

      {/* Key management — names only, write-only values, versioning/rotation, delete with confirmation */}
      <SecretsManagerNav configured={view.configured} sealed={sealed} />

      {/* Operational controls — only meaningful when OpenBao is configured & reachable */}
      {view.configured && view.reachable && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SealControl
            sealed={view.sealed}
            threshold={view.unsealThreshold}
            shares={view.unsealShares}
            progress={view.unsealProgress}
          />
          <DynamicDbPanel sealed={sealed} />
          <div className="lg:col-span-2">
            <LeasesPanel sealed={sealed} />
          </div>
        </div>
      )}

      {/* Mount table — paths + types only, never values */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Stack className="size-4 text-muted-foreground" />
              Mounts
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
                  {view.mounts.map((m) => (
                    <tr key={m.path} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-4 font-mono text-foreground">{m.path}</td>
                      <td className="py-2 pr-4">
                        <Badge variant="outline" className="text-muted-foreground">
                          {m.type}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{m.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  sub,
  tone,
}: Readonly<{
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: 'good' | 'bad' | 'muted';
}>) {
  const TONE_CLASS = { good: 'text-primary', bad: 'text-destructive', muted: 'text-foreground' };
  const valueClass = TONE_CLASS[tone];
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-1 py-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-[10px] uppercase tracking-wide">{label}</span>
        </div>
        <div className={`text-lg font-semibold ${valueClass}`}>{value}</div>
        <div className="truncate font-mono text-[10px] text-muted-foreground/70" title={sub}>
          {sub}
        </div>
      </CardContent>
    </Card>
  );
}
