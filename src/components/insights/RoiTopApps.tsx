'use client';

import Link from 'next/link';
import { Pagination } from '@/components/ui/Pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type AppRoi, formatHours, formatInr } from '@/lib/roi';
import { usePagination } from '@/lib/use-pagination';

// ─── Top apps by value — paginated, URL-driven, drills into each app's Reports (ROI card) ─────────
// The list → detail rule: a row links to /build/apps/[id]/reports where the per-app ROI card lives.
export function RoiTopApps({ apps }: { apps: AppRoi[] }) {
  const p = usePagination(apps, { key: 'app', defaultPageSize: 10 });
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>App</TableHead>
              <TableHead>Department</TableHead>
              <TableHead className="text-right">Runs</TableHead>
              <TableHead className="text-right">Hours saved</TableHead>
              <TableHead className="text-right">Value (est.)</TableHead>
              <TableHead className="text-right">AI cost</TableHead>
              <TableHead className="text-right">Net (est.)</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.pageItems.length ? (
              p.pageItems.map((a) => (
                <TableRow key={a.appId}>
                  <TableCell className="font-medium text-foreground">{a.appTitle}</TableCell>
                  <TableCell className="text-muted-foreground">{a.department}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {a.runsCompleted.toLocaleString('en-IN')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatHours(a.hoursSaved)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-foreground">
                    {formatInr(a.grossValue)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatInr(a.actualAiCost)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium tabular-nums ${
                      a.netValue >= 0 ? 'text-primary' : 'text-destructive'
                    }`}
                  >
                    {formatInr(a.netValue)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/build/apps/${a.appId}/reports`}
                      className="text-xs text-primary hover:underline"
                    >
                      detail →
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  No apps yet. Build an app and run it to surface its ROI.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination
        state={p}
        onPageChange={p.setPage}
        onPageSizeChange={p.setPageSize}
        itemLabel="apps"
      />
    </div>
  );
}
