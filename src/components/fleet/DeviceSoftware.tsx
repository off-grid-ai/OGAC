'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { SoftwareInventory } from '@/lib/fleetdm';

// Per-device software inventory + known CVEs, pulled from FleetDM on mount. Only rendered when the
// active MDM supports it (the parent gates on supportsFleet).
export function DeviceSoftware({ hostId }: Readonly<{ hostId: string }>) {
  const [inv, setInv] = useState<SoftwareInventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/fleet/hosts/${hostId}/software`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'failed to load software');
      setInv(data as SoftwareInventory);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [hostId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="shadow-sm lg:col-span-3">
      <CardHeader>
        <CardTitle className="text-sm">Installed software &amp; CVEs</CardTitle>
        <p className="text-xs text-muted-foreground">
          {inv
            ? `${inv.count} packages · ${inv.vulnerableCount} with known vulnerabilities`
            : 'From FleetDM / osquery — highest CVSS first.'}
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>
        ) : inv?.software.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Software</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Vulnerabilities</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.software.map((s) => (
                  <TableRow key={s.id || `${s.name}-${s.version}`}>
                    <TableCell className="font-medium text-foreground">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">{s.version}</TableCell>
                    <TableCell className="text-muted-foreground">{s.source}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {s.vulnerabilities.length ? (
                          s.vulnerabilities.map((v) =>
                            v.url ? (
                              <a
                                key={v.cve}
                                href={v.url}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:opacity-80"
                              >
                                <Badge variant="secondary" className="bg-destructive/10 text-destructive">
                                  {v.cve}
                                  {v.cvssScore != null ? ` · ${v.cvssScore.toFixed(1)}` : ''}
                                </Badge>
                              </a>
                            ) : (
                              <Badge
                                key={v.cve}
                                variant="secondary"
                                className="bg-destructive/10 text-destructive"
                              >
                                {v.cve}
                                {v.cvssScore != null ? ` · ${v.cvssScore.toFixed(1)}` : ''}
                              </Badge>
                            ),
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No software reported for this host.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
