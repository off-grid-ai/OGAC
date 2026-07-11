'use client';

import { Play, Terminal, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  deriveResultColumns,
  formatCell,
  formatRows,
  STARTER_QUERIES,
  type StarterQuery,
} from '@/lib/dataplane-ui';

interface QueryResult {
  columns: { name: string; type?: string }[];
  rows: Record<string, unknown>[];
  count: number;
}

// The read-only Query console. The SQL editor is the ONE legitimately-narrow measure column; the
// results table fills the page width and scrolls horizontally inside its own container. Reads are
// enforced read-only server-side — a rejected statement returns 400 and we surface the guard's exact
// reason. Starter queries run against the live `bfsi` schema.
export function QueryConsole({
  initialSql = '',
  starters = STARTER_QUERIES,
}: Readonly<{ initialSql?: string; starters?: readonly StarterQuery[] }>) {
  const [sql, setSql] = useState(initialSql);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [ranSql, setRanSql] = useState<string>('');

  async function run(statement?: string) {
    const q = (statement ?? sql).trim();
    if (!q) {
      setError('Enter a query to run.');
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    setRanSql(q);
    try {
      const res = await fetch('/api/v1/admin/warehouse/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: q }),
      });
      const body = (await res.json().catch(() => ({}))) as QueryResult & { error?: string };
      if (!res.ok) {
        setError(body.error || `Query failed (${res.status})`);
        return;
      }
      setResult({ columns: body.columns ?? [], rows: body.rows ?? [], count: body.count ?? 0 });
    } catch {
      setError('Could not reach the warehouse.');
    } finally {
      setRunning(false);
    }
  }

  function loadStarter(statement: string) {
    setSql(statement);
    run(statement);
  }

  const columnNames = result ? deriveResultColumns(result.columns, result.rows) : [];

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Terminal className="size-4 text-primary" />
          Query
        </h2>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
          Explore your warehouse with read-only SQL. Writes and schema changes are blocked — this is
          a safe, read-only window onto your data.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Editor — the one legitimately-narrow measure column. */}
        <div className="space-y-3 lg:col-span-2">
          <Textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder="SELECT ... LIMIT 100"
            spellCheck={false}
            rows={8}
            className="font-mono text-xs"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                run();
              }
            }}
          />
          <div className="flex items-center gap-3">
            <Button onClick={() => run()} disabled={running}>
              <Play className="size-4" />
              {running ? 'Running…' : 'Run'}
            </Button>
            <span className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter to run</span>
          </div>
        </div>

        {/* Starter queries. */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Starter queries</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {starters.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => loadStarter(s.sql)}
                className="w-full rounded-md border border-border p-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
              >
                <div className="text-xs font-medium text-foreground">{s.title}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{s.description}</div>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {error ? (
        <Card className="border-destructive/30">
          <CardContent className="flex items-start gap-2 py-3 text-sm text-destructive">
            <WarningCircle className="mt-0.5 size-4 shrink-0" weight="fill" />
            <div>
              <div className="font-medium">Query rejected</div>
              <div className="mt-0.5 text-xs">{error}</div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">Results</CardTitle>
            <Badge className="bg-primary/10 text-primary">{formatRows(result.count)} rows</Badge>
          </CardHeader>
          <CardContent>
            {result.rows.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Query ran successfully but returned no rows.
                {ranSql ? <span className="mt-1 block font-mono">{ranSql}</span> : null}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {columnNames.map((c) => (
                        <TableHead key={c} className="whitespace-nowrap">
                          {c}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.map((row, i) => (
                      <TableRow key={i}>
                        {columnNames.map((c) => (
                          <TableCell key={c} className="whitespace-nowrap font-mono text-xs">
                            {formatCell(row[c])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
