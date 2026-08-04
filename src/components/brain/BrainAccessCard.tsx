import { Info, Lock, Users } from '@phosphor-icons/react/dist/ssr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BrainGrant, CapabilityRow } from '@/lib/brain-access-view';

// ─── Who may use the organisation's memory ──────────────────────────────────────────────────────────
//
// Enforcement was already in the run path; the missing half was visibility. Concretely: a viewer searched
// and was refused, and there was nowhere in the console to see who is allowed — or to check the grant is
// as narrow as intended. A control nobody can audit is a control on trust.
//
// READ-ONLY on purpose. The policy is a deployment env var; editing access to organisational memory from a
// web form is not an improvement, it is a way to widen it by accident.
export function BrainAccessCard({
  rows,
  grants,
  sentence,
}: Readonly<{ rows: CapabilityRow[]; grants: BrainGrant[]; sentence: string }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Users className="size-4 text-primary" weight="duotone" />
          Who may use the organisation’s memory
        </CardTitle>
        <p className="text-xs text-muted-foreground">{sentence}</p>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {/* Every capability, including any nobody holds — an omitted row reads as "not applicable" when
            the truth is "nobody can do this". */}
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.capability} className="rounded-md border border-border bg-muted/25 p-2.5">
              <p className="text-[11px] font-medium text-foreground">{r.what}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {r.nobody ? (
                  <span className="text-amber-700 dark:text-amber-500">Nobody holds this.</span>
                ) : (
                  r.holders.join(' · ')
                )}
              </p>
            </li>
          ))}
        </ul>

        {grants.length > 0 ? (
          <div className="border-t border-border pt-2">
            <p className="text-[11px] font-medium text-foreground">What each grant covers</p>
            <ul className="mt-0.5 space-y-0.5">
              {grants.map((g, i) => (
                <li key={`${g.tenantId}-${i}`} className="text-[11px] text-muted-foreground">
                  {g.documentSets.length > 0 ? g.documentSets.join(', ') : 'no document set named'} —{' '}
                  {g.capabilities.join(', ') || 'no capabilities'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground/80">
          <Lock className="mt-0.5 size-3 shrink-0" />
          Set in the deployment configuration, not here. Changing who may read the organisation’s memory is
          an operator action on the host — deliberately not a form on this page.
        </p>
      </CardContent>
    </Card>
  );
}

/** Shown when the policy is absent entirely, which is different from a policy that grants nothing. */
export function BrainAccessAbsent() {
  return (
    <Card className="shadow-sm">
      <CardContent className="flex items-start gap-2 py-4 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          No organisational-memory access policy is configured on this deployment, so the memory features are
          off rather than restricted — nobody is refused, because there is nothing to refuse them from.
        </span>
      </CardContent>
    </Card>
  );
}
