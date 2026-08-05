import { readRetentionPosture } from '@/lib/adapters/store-retention-read';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// ─── StoreRetentionPosture — the half of the retention claim the sweep cannot cover ───────────────
//
// The sweep below proves DATABASE records were deleted. The observability stores — metrics, logs — set
// retention as a deploy flag rather than through an API, so no sweep touches them and the console cannot
// write their window. That boundary is deliberate. Being unable to STATE the window is not.
//
// The panel exists to keep three answers apart that a dashboard would flatten into one number:
// confirmed by the store, assumed from a built-in default nobody chose, and unknown. An auditor asking
// "who decided 7 days?" needs to be told when the answer is "nobody".
const LABEL: Record<string, { text: string; tone: 'ok' | 'warn' | 'bad' }> = {
  confirmed: { text: 'confirmed', tone: 'ok' },
  'assumed-default': { text: 'assumed', tone: 'warn' },
  unknown: { text: 'unknown', tone: 'bad' },
  unbounded: { text: 'kept forever', tone: 'bad' },
};

export async function StoreRetentionPosture() {
  const posture = await readRetentionPosture();

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm">How long the metric and log stores keep data</CardTitle>
          <CardDescription className="text-xs">
            These are set when the deployment is built, not from here — so this reports what each store
            says, and says so when a store will not tell us.
          </CardDescription>
        </div>
        <Badge variant={posture.claimable ? 'secondary' : 'destructive'}>
          {posture.claimable ? 'all confirmed' : `${posture.unproven} unproven`}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className={posture.claimable ? 'text-sm' : 'text-sm font-medium text-destructive'}>
          {posture.sentence}
        </p>
        <div className="divide-y divide-border rounded-md border border-border">
          {posture.stores.map((s) => {
            const label = LABEL[s.confidence] ?? LABEL.unknown;
            return (
              <div key={s.storeId} className="space-y-1 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{cap(s.holds)}</span>
                  <span className="flex items-center gap-2">
                    {s.window ? <span className="text-sm tabular-nums">{s.window}</span> : null}
                    <Badge variant={label.tone === 'ok' ? 'secondary' : 'destructive'}>
                      {label.text}
                    </Badge>
                  </span>
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">{s.sentence}</p>
              </div>
            );
          })}
          {posture.stores.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No stores were checked, so nothing can be said about how long they keep data.
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
