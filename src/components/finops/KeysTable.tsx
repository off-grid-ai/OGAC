'use client';

import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
import { KeyToggle } from '@/components/finops/KeyToggle';
import { Badge } from '@/components/ui/badge';
import { Pagination } from '@/components/ui/Pagination';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { KeySpend } from '@/lib/finops';
import { usePagination } from '@/lib/use-pagination';

const usd = (n: number) => `$${n.toFixed(2)}`;

// The virtual-key roster can grow large (one row per issued key). Paginate the server-computed
// rows client-side — the page stays a thin server component, this client leaf owns the slice +
// control. URL-namespaced by `keys` so it deep-links and Back-button steps through pages.
export function KeysTable({ rows }: { rows: KeySpend[] }) {
  const paged = usePagination(rows, { key: 'keys', defaultPageSize: 25 });

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="w-40">Budget</TableHead>
            <TableHead className="w-16">On</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {paged.pageItems.map((k) => (
            <TableRow key={k.id}>
              <TableCell className="font-medium text-foreground">{k.label}</TableCell>
              <TableCell>
                <Badge variant="secondary">
                  {k.subjectType}:{k.subject}
                </Badge>
              </TableCell>
              <TableCell className="text-right text-muted-foreground">{usd(k.costUsd)}</TableCell>
              <TableCell>
                {k.budgetUsd ? (
                  <div className="flex items-center gap-2">
                    <Progress value={Math.min(k.pct ?? 0, 100)} className="flex-1" />
                    <span className="text-xs text-muted-foreground">{k.pct}%</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">unlimited</span>
                )}
              </TableCell>
              <TableCell>
                <KeyToggle id={k.id} enabled={k.enabled} label={k.label} />
              </TableCell>
              <TableCell>
                <DeleteRowButton url={`/api/v1/admin/keys/${k.id}`} label={k.label} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination
        state={paged}
        onPageChange={paged.setPage}
        onPageSizeChange={paged.setPageSize}
        itemLabel="keys"
      />
    </div>
  );
}
