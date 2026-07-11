'use client';

import { Key, MapPin, ArrowsLeftRight, Info } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toDisplayHost } from '@/lib/display-host';

interface InferredToken {
  provider?: string;
  tokenType?: string;
  jwt?: { header: Record<string, unknown>; payload: Record<string, unknown> };
  notes?: string;
}

interface RoutingOverride {
  sourceIp: string;
  targetIp?: string;
  targetNode?: string;
  note?: string;
}

interface TokenRow {
  fingerprint: string;
  preview: string;
  kind: 'bearer' | 'x-api-key';
  inferred: InferredToken;
  ips: Record<string, number>;
  routingOverrides: RoutingOverride[];
  meta: Record<string, unknown>;
  uses: number;
  firstSeen: string;
  lastSeen: string;
}

function ProviderBadge({ inferred }: Readonly<{ inferred: InferredToken }>) {
  if (!inferred.provider) return <span className="text-muted-foreground text-xs">{inferred.tokenType ?? 'opaque'}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="secondary" className="text-xs font-mono">{inferred.provider}</Badge>
      {inferred.tokenType && <span className="text-muted-foreground text-xs">{inferred.tokenType}</span>}
    </span>
  );
}

function IpList({ ips }: Readonly<{ ips: Record<string, number> }>) {
  const entries = Object.entries(ips).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="space-y-0.5">
      {entries.map(([ip, count]) => (
        <div key={ip} className="flex items-center gap-1.5 text-xs font-mono">
          <span>{toDisplayHost(ip)}</span>
          <span className="text-muted-foreground">×{count}</span>
        </div>
      ))}
    </div>
  );
}

function RoutingOverrides({ overrides }: Readonly<{ overrides: RoutingOverride[] }>) {
  if (!overrides.length) return <span className="text-muted-foreground text-xs">none</span>;
  return (
    <div className="space-y-1">
      {overrides.map((o, i) => (
        <div key={i} className="text-xs font-mono flex items-center gap-1">
          <span className="text-muted-foreground">{toDisplayHost(o.sourceIp)}</span>
          <ArrowsLeftRight size={10} className="text-muted-foreground shrink-0" />
          <span className="text-primary">{o.targetIp ? toDisplayHost(o.targetIp) : (o.targetNode ?? '?')}</span>
          {o.note && <span className="text-muted-foreground ml-1 not-font-mono">({o.note})</span>}
        </div>
      ))}
    </div>
  );
}

function JwtDetail({ jwt }: Readonly<{ jwt: InferredToken['jwt'] }>) {
  if (!jwt) return null;
  const { payload } = jwt;
  const fields = ['sub', 'iss', 'aud', 'exp', 'iat', 'email', 'scope'].filter((k) => payload[k] !== undefined);
  return (
    <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
      {fields.map((k) => (
        <div key={k} className="font-mono">
          <span className="text-foreground/60">{k}: </span>
          <span>{String(payload[k])}</span>
        </div>
      ))}
    </div>
  );
}

export function GatewayTokens() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/v1/gateway/tokens');
      const d = await r.json() as { available: boolean; tokens: TokenRow[] };
      if (d.available) setTokens(d.tokens);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const ago = (ts: string) => {
    const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex flex-row items-start justify-between gap-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Key size={14} />
            Enterprise Client Tokens
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Client credentials (bearer JWTs) observed in gateway traffic — read-only monitoring of who is
          calling in. To issue new keys for your own clients, use the <span className="font-medium text-foreground">API keys</span> tab,
          which mints <span className="font-mono">ogak_</span> keys.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {tokens.length === 0 ? (
          <p className="text-muted-foreground text-sm p-6">
            {loading ? 'Fetching tokens…' : 'No client tokens seen yet. Tokens appear here once an enterprise client sends a request through the gateway.'}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Token</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead><span className="flex items-center gap-1"><MapPin size={12} />IPs</span></TableHead>
                <TableHead><span className="flex items-center gap-1"><ArrowsLeftRight size={12} />Routing overrides</span></TableHead>
                <TableHead className="text-right">Uses</TableHead>
                <TableHead className="text-right">Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((t) => (
                <>
                  <TableRow
                    key={t.fingerprint}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setExpanded(expanded === t.fingerprint ? null : t.fingerprint)}
                  >
                    <TableCell className="font-mono text-xs">
                      <span className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{t.kind === 'bearer' ? 'Bearer' : 'x-api-key'}</Badge>
                        {t.preview}
                      </span>
                    </TableCell>
                    <TableCell><ProviderBadge inferred={t.inferred} /></TableCell>
                    <TableCell><IpList ips={t.ips} /></TableCell>
                    <TableCell><RoutingOverrides overrides={t.routingOverrides ?? []} /></TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{t.uses}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{ago(t.lastSeen)}</TableCell>
                  </TableRow>
                  {expanded === t.fingerprint && (
                    <TableRow key={`${t.fingerprint}-detail`} className="bg-muted/20">
                      <TableCell colSpan={6} className="py-3 px-4">
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <p className="font-medium mb-1 flex items-center gap-1"><Info size={11} /> Inferred details</p>
                            {t.inferred.notes && <p className="text-muted-foreground">{t.inferred.notes}</p>}
                            {t.inferred.jwt && <JwtDetail jwt={t.inferred.jwt} />}
                          </div>
                          <div>
                            <p className="font-medium mb-1">Meta</p>
                            {Object.keys(t.meta ?? {}).length === 0
                              ? <p className="text-muted-foreground">No operator metadata set.</p>
                              : <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap">{JSON.stringify(t.meta, null, 2)}</pre>
                            }
                            <p className="text-muted-foreground mt-2">First seen: {new Date(t.firstSeen).toLocaleString()}</p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
