'use client';

import { SealCheck, ShieldWarning, Warning } from '@phosphor-icons/react/dist/ssr';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { VerificationStatus } from '@/lib/provenance-verify';
import type { ProvenanceRow } from '@/lib/provenance-view';

// Per-row verification status, either from the server-rendered read (verified/unverified) or from a
// live Verify action (the richer 4-way verdict). '' = never explicitly verified this session.
type RowStatus = VerificationStatus | '';

interface VerdictResponse {
  runId: string;
  status: VerificationStatus;
  detail: string;
  ok: boolean;
}

const STATUS_STYLE: Record<VerificationStatus, { label: string; className: string; Icon: typeof SealCheck }> = {
  verified: { label: 'verified', className: 'bg-primary/10 text-primary', Icon: SealCheck },
  tampered: { label: 'tampered', className: 'bg-destructive/10 text-destructive', Icon: ShieldWarning },
  'key-mismatch': { label: 'key mismatch', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', Icon: Warning },
  unsigned: { label: 'unsigned', className: 'bg-muted text-muted-foreground', Icon: Warning },
};

function StatusBadge({ status, verified }: Readonly<{ status: RowStatus; verified: boolean }>) {
  if (status === '') {
    // No live verdict yet — fall back to the server's read-time boolean.
    return verified ? (
      <Badge variant="secondary" className="bg-primary/10 text-primary">
        verified
      </Badge>
    ) : (
      <Badge variant="secondary" className="bg-destructive/10 text-destructive">
        unverified
      </Badge>
    );
  }
  const s = STATUS_STYLE[status];
  return (
    <Badge variant="secondary" className={s.className}>
      <s.Icon className="mr-1 size-3" />
      {s.label}
    </Badge>
  );
}

export function ProvenanceLedger({ rows }: Readonly<{ rows: ProvenanceRow[] }>) {
  // Live verdicts keyed by runId, layered over the server-rendered rows.
  const [verdicts, setVerdicts] = useState<Record<string, RowStatus>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);

  const verifiable = useMemo(() => rows.filter((r) => r.runId), [rows]);

  const applyVerdicts = (vs: VerdictResponse[]) => {
    setVerdicts((prev) => {
      const next = { ...prev };
      for (const v of vs) next[v.runId] = v.status;
      return next;
    });
    for (const v of vs) {
      if (v.status === 'verified') toast.success(`${v.runId}: ${v.detail}`);
      else if (v.status === 'unsigned') toast.message(`${v.runId}: ${v.detail}`);
      else toast.error(`${v.runId}: ${v.detail}`);
    }
  };

  const verifyOne = async (runId: string) => {
    setBusy((b) => ({ ...b, [runId]: true }));
    try {
      const res = await fetch('/api/v1/admin/provenance/verify/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      const d = (await res.json()) as VerdictResponse & { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Verification failed.');
      applyVerdicts([d]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy((b) => ({ ...b, [runId]: false }));
    }
  };

  const verifyAll = async () => {
    const ids = verifiable.map((r) => r.runId);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch('/api/v1/admin/provenance/verify/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runIds: ids }),
      });
      const d = (await res.json()) as {
        results?: VerdictResponse[];
        verified?: number;
        failed?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(d.error ?? 'Bulk verification failed.');
      const results = d.results ?? [];
      setVerdicts((prev) => {
        const next = { ...prev };
        for (const v of results) next[v.runId] = v.status;
        return next;
      });
      toast.success(`Verified ${d.verified ?? 0} · ${d.failed ?? 0} failed of ${results.length}.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  if (rows.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No signed provenance records yet. Run an agent to produce a signed answer.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {verifiable.length} of {rows.length} records can be re-verified on demand against the
          active signing key.
        </p>
        <Button size="sm" variant="outline" disabled={bulkBusy || verifiable.length === 0} onClick={() => void verifyAll()}>
          <SealCheck className="mr-1 size-3.5" />
          {bulkBusy ? 'Verifying…' : `Verify all (${verifiable.length})`}
        </Button>
      </div>

      {/* Full-width ledger — wide columns for the long identifiers, table scrolls only if it must. */}
      <div className="w-full overflow-x-auto">
        <Table className="w-full">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[34%]">Subject</TableHead>
              <TableHead className="w-[26%]">Signer</TableHead>
              <TableHead className="w-[12%]">Signature</TableHead>
              <TableHead className="w-[12%]">Status</TableHead>
              <TableHead className="w-[10%]">Signed</TableHead>
              <TableHead className="w-[6%] text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const status = r.runId ? (verdicts[r.runId] ?? '') : '';
              return (
                <TableRow key={`${r.runId || r.subject}-${i}`}>
                  <TableCell className="font-mono text-xs text-foreground">
                    <span className="block truncate" title={r.subject}>
                      {r.subject}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    <span className="block truncate" title={r.signer}>
                      {r.signer}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.sha256Short}</TableCell>
                  <TableCell>
                    <StatusBadge status={status} verified={r.verified} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {r.timestamp ? r.timestamp.slice(0, 16).replace('T', ' ') : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.runId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={!!busy[r.runId]}
                        onClick={() => void verifyOne(r.runId)}
                      >
                        {busy[r.runId] ? 'Verifying…' : 'Verify'}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
