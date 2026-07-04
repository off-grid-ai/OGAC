import Link from 'next/link';
import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
import { AddGoldenCaseButton } from '@/components/brain/AddGoldenCaseButton';
import { AddPromptButton } from '@/components/brain/AddPromptButton';
import { AddToolButton } from '@/components/brain/AddToolButton';
import { BrainSearch } from '@/components/brain/BrainSearch';
import { GroundingVerifier } from '@/components/brain/GroundingVerifier';
import { IngestMenu } from '@/components/brain/IngestMenu';
import { RouterConsole } from '@/components/brain/RouterConsole';
import { RunEvalButton } from '@/components/brain/RunEvalButton';
import { ToolToggle } from '@/components/brain/ToolToggle';
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
import { listEvalRuns, listGoldenCases } from '@/lib/evals';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';
import { listDatasets, listPrompts, listTools } from '@/lib/store';

export const dynamic = 'force-dynamic';

const TOOL_TYPE: Record<string, string> = {
  http: 'bg-blue-500/10 text-blue-600',
  mcp: 'bg-primary/10 text-primary',
};

export default async function BrainPage() {
  await requireModuleForUser('brain');
  const org = await currentOrgId();
  const [docs, cases, runs, datasets, tools, promptList] = await Promise.all([
    listDocuments(),
    listGoldenCases(),
    listEvalRuns(1),
    listDatasets(org),
    listTools(org),
    listPrompts(),
  ]);
  const latest = runs[0];
  const datasetOpts = datasets.map((d) => ({ id: d.id, name: d.name }));

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Retrieval router</CardTitle>
          <p className="text-xs text-muted-foreground">
            Detects intent and routes across the knowledge base, structured databases, and
            tools/services — fused, with provenance on every hit.
          </p>
        </CardHeader>
        <CardContent>
          <RouterConsole />
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm">Tools &amp; services · {tools.length}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              The router&apos;s <code>tool</code> source — HTTP / MCP tools matched to query intent.
            </p>
          </div>
          <AddToolButton />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>When to use</TableHead>
                <TableHead className="w-16">Enabled</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tools.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium text-foreground">{t.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={TOOL_TYPE[t.type]}>
                      {t.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-sm truncate text-muted-foreground">
                    {t.description || t.endpoint}
                  </TableCell>
                  <TableCell>
                    <ToolToggle id={t.id} enabled={t.enabled} />
                  </TableCell>
                  <TableCell>
                    <DeleteRowButton url={`/api/v1/admin/tools/${t.id}`} label={t.name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Retrieval (Brain only)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Ingestion→retrieval (RAG) on LanceDB · embeddings via the gateway.
          </p>
        </CardHeader>
        <CardContent>
          <BrainSearch />
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Knowledge base · {docs.length} documents</CardTitle>
          <IngestMenu datasets={datasetOpts} />
        </CardHeader>
        <CardContent className="space-y-2">
          {docs.map((d) => (
            <div key={d.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/brain/docs/${d.id}`} className="text-sm font-medium text-foreground hover:text-primary">
                  {d.title}
                </Link>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{d.source}</Badge>
                  <DeleteRowButton url={`/api/v1/admin/brain/documents/${d.id}`} label={d.title} />
                </div>
              </div>
              <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{d.text}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm">Prompt registry · {promptList.length}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Versioned, immutable prompt templates — publishing a change creates a new version.
            </p>
          </div>
          <AddPromptButton />
        </CardHeader>
        <CardContent>
          {promptList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No prompts yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Version</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promptList.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-foreground">
                      <Link href={`/brain/prompts/${p.id}`} className="hover:text-primary">
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.description || '—'}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      v{p.latestVersion}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-3">
            <CardTitle className="text-sm">Evals · golden set</CardTitle>
            {latest ? (
              <Badge
                variant="secondary"
                className={
                  latest.score >= 80
                    ? 'bg-primary/10 text-primary'
                    : 'bg-amber-500/10 text-amber-600'
                }
              >
                {latest.passed}/{latest.total} · {latest.score}%
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <AddGoldenCaseButton />
            <RunEvalButton />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Query</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Last result</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((c) => {
                const r = latest?.results?.find((x) => x.query === c.query);
                return (
                  <TableRow key={c.id}>
                    <TableCell className="text-foreground">{c.query}</TableCell>
                    <TableCell className="text-muted-foreground">{c.expected}</TableCell>
                    <TableCell>
                      {r ? (
                        <Badge
                          variant="secondary"
                          className={
                            r.pass
                              ? 'bg-primary/10 text-primary'
                              : 'bg-destructive/10 text-destructive'
                          }
                        >
                          {r.pass ? 'pass' : 'fail'} · {r.top}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <DeleteRowButton url={`/api/v1/admin/golden-cases/${c.id}`} label="case" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <GroundingVerifier />
    </div>
  );
}
