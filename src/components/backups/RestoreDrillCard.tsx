import { CheckCircle, Warning, XCircle } from '@phosphor-icons/react/dist/ssr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DrillRecord, DrillStatus } from '@/lib/dr-drill';
import { utcStamp } from '@/lib/timestamp';

// ─── "Have we proven we can actually restore this?" ────────────────────────────────────────────────
//
// The backups page listed artefacts and their schedule. It could not answer the only question that
// matters during an incident: has anyone ever restored one? A backup nobody has restored is a hope.
//
// The fleet drill proves the whole chain and used to print it to stdout, so the proof evaporated with the
// terminal session. It now writes a record; this renders it — including, loudly, the case where there
// isn't one.
//
// Presentation only: `drillStatus` (pure) decided never/fresh/stale/failed and wrote the sentence.
export function RestoreDrillCard({
  status,
  record,
}: Readonly<{ status: DrillStatus; record: DrillRecord | null }>) {
  const tone =
    status.state === 'fresh'
      ? 'text-primary'
      : status.state === 'failed'
        ? 'text-destructive'
        : 'text-amber-600';

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {status.state === 'fresh' ? (
            <CheckCircle className={`size-4 ${tone}`} weight="fill" />
          ) : status.state === 'failed' ? (
            <XCircle className={`size-4 ${tone}`} weight="fill" />
          ) : (
            <Warning className={`size-4 ${tone}`} weight="fill" />
          )}
          Restore rehearsal
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Whether a backup has been restored for real — not whether one exists.
        </p>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <p className={status.state === 'fresh' ? 'text-foreground' : `font-medium ${tone}`}>
          {status.sentence}
        </p>

        {record ? (
          <>
            <p className="font-mono text-[11px] text-muted-foreground">
              {utcStamp(record.ranAt)}
              {record.ranBy ? ` · ${record.ranBy}` : ''}
            </p>
            {/* Every stage, passing ones included. A DR proof that only shows failures cannot be read as
                evidence of what was actually exercised. */}
            {record.stages.length > 0 ? (
              <ul className="space-y-0.5">
                {record.stages.map((s) => (
                  <li key={s.name} className="flex items-start gap-1.5 text-[11px]">
                    {s.ok ? (
                      <CheckCircle className="mt-0.5 size-3 shrink-0 text-primary" weight="fill" />
                    ) : (
                      <XCircle className="mt-0.5 size-3 shrink-0 text-destructive" weight="fill" />
                    )}
                    <span className={s.ok ? 'text-muted-foreground' : 'text-destructive'}>
                      {s.name}
                      {s.detail ? <span className="text-muted-foreground/80"> — {s.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
