'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Expectation {
  expectationType: string;
  kind: string;
  column: string;
  kwargs: Record<string, unknown>;
  reason: string;
  basis: 'observed' | 'inferred';
}
interface Suite {
  table: string;
  expectations: Expectation[];
}

const KIND_CLASS: Record<string, string> = {
  not_null: 'bg-primary/10 text-primary',
  unique: 'bg-blue-500/10 text-blue-600',
  type: 'bg-muted text-muted-foreground',
  range: 'bg-amber-500/10 text-amber-600',
  allowed_values: 'bg-purple-500/10 text-purple-600',
  regex: 'bg-teal-500/10 text-teal-600',
};

const PLACEHOLDER = `customer_id: integer
email: string
status: string
balance_amount: number
created_at: timestamp`;

// Auto-generate data-quality expectations from a table schema. The operator pastes columns (one per
// line, "name: type"); the tool proposes Great-Expectations-style checks (not-null, unique, ranges,
// allowed-values, format) — a starting suite to confirm, never auto-enforced.
export function SuggestExpectationsTool() {
  const [table, setTable] = useState('');
  const [schemaText, setSchemaText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Suite | null>(null);
  const [error, setError] = useState<string | null>(null);

  function parseColumns(text: string) {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, type] = line.split(':').map((s) => s.trim());
        return { name, type: type || undefined };
      })
      .filter((c) => c.name);
  }

  async function generate() {
    const columns = parseColumns(schemaText);
    if (columns.length === 0) {
      setError('Add at least one column ("name: type" per line).');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/copilot/suggest-expectations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ table: table.trim() || 'dataset', columns }),
      });
      if (!res.ok) {
        setError(`Request failed (${res.status})`);
        return;
      }
      setResult((await res.json()) as Suite);
    } catch {
      setError('Could not reach the generator.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <Card className="h-fit shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Paste a table schema</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            One column per line as <code className="text-foreground">name: type</code>. We propose
            data-quality checks you can confirm.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Table name</label>
            <Input value={table} onChange={(e) => setTable(e.target.value)} placeholder="customers" />
          </div>
          <Textarea
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            placeholder={PLACEHOLDER}
            rows={8}
            className="font-mono text-xs"
          />
          <Button onClick={generate} disabled={loading}>
            {loading ? 'Generating…' : 'Generate expectations'}
          </Button>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">
            Proposed expectations{' '}
            {result ? `· ${result.table} (${result.expectations.length})` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!result ? (
            <p className="text-sm text-muted-foreground">Paste a schema to generate checks.</p>
          ) : result.expectations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No expectations generated for this schema.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Column</TableHead>
                    <TableHead>Check</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead>Basis</TableHead>
                    <TableHead>Why</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.expectations.map((e, i) => (
                    <TableRow key={`${e.column}-${e.kind}-${i}`}>
                      <TableCell className="font-medium text-foreground">{e.column}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={KIND_CLASS[e.kind] ?? 'bg-muted'}>
                          {e.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {e.expectationType}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.basis}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
