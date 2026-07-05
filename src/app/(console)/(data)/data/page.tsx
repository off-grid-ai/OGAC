import { AddConnectorButton } from '@/components/data/AddConnectorButton';
import { AddMaskingRuleButton } from '@/components/data/AddMaskingRuleButton';
import { ConnectorActions } from '@/components/data/ConnectorActions';
import { ErasureForm } from '@/components/data/ErasureForm';
import { MaskingRuleToggle } from '@/components/data/MaskingRuleToggle';
import { PiiScanner } from '@/components/data/PiiScanner';
import { ReindexQdrantButton } from '@/components/data/ReindexQdrantButton';
import { VectorDBInspector } from '@/components/data/VectorDBInspector';
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
import { listDocuments } from '@/lib/brain';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';
import { qdrantCollectionName, qdrantCount } from '@/lib/qdrant';
import { listConnectors, listDatasets, listIngestJobs, listMaskingRules } from '@/lib/store';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = {
  connected: 'bg-primary/10 text-primary',
  completed: 'bg-primary/10 text-primary',
  error: 'bg-destructive/10 text-destructive',
  failed: 'bg-destructive/10 text-destructive',
};

const CLASSIFICATION: Record<string, string> = {
  pii: 'bg-destructive/10 text-destructive',
  phi: 'bg-destructive/10 text-destructive',
  public: 'bg-primary/10 text-primary',
};

export default async function DataPage() {
  await requireModuleForUser('data');
  const org = await currentOrgId();
  const [connectors, jobs, rules, datasets, brainDocs, qCount] = await Promise.all([
    listConnectors(org),
    listIngestJobs(),
    listMaskingRules(org),
    listDatasets(org),
    listDocuments(),
    qdrantCount(),
  ]);

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Connectors</CardTitle>
          <AddConnectorButton />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sync</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {connectors.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.type}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={STATUS[c.status]}>
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.lastSync ? c.lastSync.slice(0, 10) : 'never'}
                  </TableCell>
                  <TableCell>
                    <ConnectorActions id={c.id} name={c.name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Ingest jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Connector</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="text-foreground">{j.connectorName}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS[j.status]}>
                        {j.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {j.records.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">PII masking rules</CardTitle>
            <AddMaskingRuleButton />
          </CardHeader>
          <CardContent className="space-y-2">
            {rules.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground">{r.kind}</span>
                  <Badge variant="secondary">{r.action}</Badge>
                </div>
                <MaskingRuleToggle id={r.id} initial={r.enabled} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Data catalog</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dataset</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead>Classification</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {datasets.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium text-foreground">{d.name}</TableCell>
                  <TableCell className="text-muted-foreground">{d.source}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {d.rows.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={CLASSIFICATION[d.classification]}>
                      {d.classification}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Retention &amp; erasure (DSAR)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <ErasureForm />
          <p className="text-xs text-muted-foreground">
            Right-to-erasure propagates across the lake, KB, vector index, memory, and audit.
          </p>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Vector index (Qdrant)</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Push the Brain&apos;s documents into Qdrant so switching the retrieval backend
            (OFFGRID_ADAPTER_RETRIEVAL=qdrant) lands on a populated store, not an empty one.
          </p>
        </CardHeader>
        <CardContent>
          <ReindexQdrantButton
            collection={qdrantCollectionName()}
            qdrantCount={qCount}
            sourceDocs={brainDocs.length}
          />
        </CardContent>
      </Card>

      <VectorDBInspector urlHint={process.env.OFFGRID_QDRANT_URL ?? 'http://offgrid-s1.local:6333'} />

      <PiiScanner />
    </div>
  );
}
