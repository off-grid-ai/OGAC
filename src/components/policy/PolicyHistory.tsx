import { ArrowDown, MinusCircle, PlusCircle, PencilSimple, Power } from '@phosphor-icons/react/dist/ssr';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { describeRule, type RuleChange } from '@/lib/policy-version';
import type { PolicyVersionRecord } from '@/lib/policy-versions-store';

const CHANGE_ICON: Record<RuleChange['kind'], typeof PlusCircle> = {
  added: PlusCircle,
  removed: MinusCircle,
  changed: PencilSimple,
  enabled: Power,
  disabled: Power,
};

const CHANGE_TONE: Record<RuleChange['kind'], string> = {
  added: 'text-primary',
  removed: 'text-destructive',
  changed: 'text-amber-600 dark:text-amber-500',
  enabled: 'text-primary',
  disabled: 'text-destructive',
};

function when(d: Date): string {
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── What the policy said, and when it changed ─────────────────────────────────────────────────────
//
// A DPO reviewing a decision from three months ago needs the rules AS THEY WERE THEN. Policy rules
// are edited in place, so this was unanswerable — the console could only ever show today's rules.
//
// Each version is an immutable snapshot. The change list is written in operator language, because the
// person who has to sign off on a policy change is not reading a JSON diff.
export function PolicyHistory({
  versions,
  focusVersion = null,
}: Readonly<{
  versions: PolicyVersionRecord[];
  /** Arrives as ?v=<n> from a run — the version that run was judged under. */
  focusVersion?: number | null;
}>) {
  if (!versions.length) {
    return (
      <Card className="shadow-sm">
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No policy changes recorded yet. The next change you make to the rules is captured here
            with what changed and who changed it — this is empty because nothing has changed since
            history started, not because history is off.
          </p>
        </CardContent>
      </Card>
    );
  }

  const [current, ...past] = versions;
  // When a run linked here, show THAT version's rules in the left panel — the reader came to find out
  // what applied to their run, not what applies today. Falls back to current when v is unknown, and
  // says which it is showing either way.
  const focused = focusVersion != null ? versions.find((v) => v.version === focusVersion) : undefined;
  const shown = focused ?? current;
  const isHistoric = shown.version !== current.version;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* WHAT IS ENFORCED RIGHT NOW — the version an auditor is told is live. */}
      <Card className="shadow-sm xl:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            {isHistoric ? 'What applied then' : 'In force now'}
            <Badge
              variant="secondary"
              className={
                isHistoric
                  ? 'bg-amber-500/10 font-mono text-amber-700 dark:text-amber-500'
                  : 'bg-primary/10 font-mono text-primary'
              }
            >
              v{shown.version}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {isHistoric ? 'Recorded ' : 'Since '}
            {when(shown.createdAt)}
            {shown.changedBy ? <> · set by {shown.changedBy}</> : null}
          </p>
          {isHistoric ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
              These are not the rules in force today — v{current.version} is. This is what was
              enforced at the time, which is what a decision from then must be judged against.
            </p>
          ) : null}
          {focusVersion != null && !focused ? (
            <p className="rounded-md border border-border p-2 text-[11px] text-muted-foreground">
              Version {focusVersion} is not in this history, so we will not claim what it contained.
              Showing the current version instead.
            </p>
          ) : null}
          <ul className="space-y-1.5">
            {shown.rules.map((r) => (
              <li key={r.name} className="text-xs">
                <span className={r.enabled ? 'text-foreground' : 'text-muted-foreground line-through'}>
                  {describeRule(r)}
                </span>
                {!r.enabled ? (
                  <span className="ml-1 text-[11px] text-destructive">not enforced</span>
                ) : null}
              </li>
            ))}
            {!shown.rules.length ? (
              <li className="text-xs text-muted-foreground">
                This version enforces no rules — nothing is being blocked by policy.
              </li>
            ) : null}
          </ul>
          <p className="font-mono text-[11px] text-muted-foreground/70">
            fingerprint {shown.digest}
          </p>
        </CardContent>
      </Card>

      {/* THE TRAIL. Newest first, each with the change in words. */}
      <Card className="shadow-sm xl:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Change history</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            {[current, ...past].map((v, i) => (
              <li
                key={v.version}
                className={`relative rounded-md pl-6 ${v.version === shown.version && isHistoric ? 'bg-amber-500/[0.07] py-1.5' : ''}`}
              >
                {i < versions.length - 1 ? (
                  <ArrowDown className="absolute left-0 top-5 size-3 text-border" />
                ) : null}
                <Badge
                  variant="outline"
                  className="absolute left-0 top-0 -translate-x-0 font-mono text-[10px]"
                >
                  {v.version}
                </Badge>
                <div className="ml-6">
                  <p className="text-xs font-medium text-foreground">{v.summary}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {when(v.createdAt)}
                    {v.changedBy ? <> · {v.changedBy}</> : <> · actor not recorded</>}
                  </p>
                  {v.changes.length ? (
                    <ul className="mt-1.5 space-y-1">
                      {v.changes.map((c, ci) => {
                        const Icon = CHANGE_ICON[c.kind] ?? PencilSimple;
                        return (
                          <li key={`${c.rule}-${ci}`} className="flex items-start gap-1.5 text-xs">
                            <Icon className={`mt-0.5 size-3.5 shrink-0 ${CHANGE_TONE[c.kind]}`} />
                            <span>
                              <span className="font-medium text-foreground">{c.rule}</span>{' '}
                              <span className="text-muted-foreground">— {c.detail}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
