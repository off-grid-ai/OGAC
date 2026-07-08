import { SealCheck, Warning } from '@phosphor-icons/react/dist/ssr';
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
import { requireModuleForUser } from '@/lib/module-access';
import { readProvenanceView } from '@/lib/provenance-view';

export const dynamic = 'force-dynamic';

export default async function ProvenancePage() {
  await requireModuleForUser('provenance');
  const view = await readProvenanceView(50);

  const stats = [
    { label: 'Signed records', value: String(view.total), icon: SealCheck },
    { label: 'Verified', value: String(view.verified), icon: SealCheck },
    { label: 'Unverified', value: String(view.unverified), icon: Warning },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <SealCheck className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Provenance</h1>
          <p className="text-sm text-muted-foreground">
            Verifiable, signed provenance for answers &amp; artifacts — each record re-verified
            against the active signing key. Tamper-evident, offline-verifiable, on-prem.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label} className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
                {s.label}
              </CardTitle>
              <s.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-foreground">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Signed manifests</CardTitle>
          <p className="text-xs text-muted-foreground">
            Recent signed provenance records — newest first. Verification status is recomputed at
            read time from the manifest signature and the active public key.
          </p>
        </CardHeader>
        <CardContent>
          {view.records.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Signer</TableHead>
                  <TableHead>SHA-256</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Signed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.records.map((r, i) => (
                  <TableRow key={`${r.subject}-${i}`}>
                    <TableCell className="max-w-xs truncate font-mono text-xs text-foreground">
                      {r.subject}
                    </TableCell>
                    <TableCell className="max-w-xs truncate font-mono text-xs text-muted-foreground">
                      {r.signer}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.sha256Short}
                    </TableCell>
                    <TableCell>
                      {r.verified ? (
                        <Badge variant="secondary" className="bg-primary/10 text-primary">
                          verified
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-destructive/10 text-destructive">
                          unverified
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {r.timestamp ? r.timestamp.slice(0, 16).replace('T', ' ') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No signed provenance records yet. Run an agent to produce a signed answer.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
