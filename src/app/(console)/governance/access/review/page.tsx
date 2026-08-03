import { PageFrame } from '@/components/PageFrame';
import { AccessReviewPanel } from '@/components/access/AccessReviewPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { lastAuditedActivityByEmail } from '@/lib/access-activity';
import { listAccessReviews } from '@/lib/access-reviews-store';
import { requireModuleForUser } from '@/lib/module-access';
import { listUsers } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Certify who should still have access ────────────────────────────────────────────────────────────
//
// A REAL ROUTE, not a special case inside /governance/access/[id]. It began life as an `if (id ===
// 'review')` branch in that dynamic router, which a route-existence test caught: the capability map
// pointed at /governance/access/review and no module lived there. A surface an auditor is sent to
// should be a route in its own right.
//
// Deliberately NOT behind the identity-provider gate the other access tabs use: this reviews the
// CONSOLE's own user list, which exists whether or not Keycloak is wired, and gating it would hide the
// artefact on exactly the deployments most likely to be asked for one.
export default async function AccessReviewPage() {
  await requireModuleForUser('admin');
  const org = await currentOrgId();
  const [people, past] = await Promise.all([listUsers(org), listAccessReviews(org, 10)]);
  // Last activity is what makes a review meaningful — a list of names with no usage signal is what
  // gets rubber-stamped. If the ledger is unreachable we get null, and every row would then read "has
  // never signed in", which is a fabricated finding — so that case is surfaced instead.
  const activity = await lastAuditedActivityByEmail(org).catch(() => null);

  return (
    <PageFrame>
      <div className="w-full space-y-4">
        <AccessReviewPanel
          subjects={people.map((u) => ({
            id: u.id,
            email: u.email ?? '',
            name: u.name,
            role: u.role,
            lastActiveAt: activity?.[(u.email ?? '').toLowerCase()] ?? null,
          }))}
          lastReviewedAt={past[0]?.completedAt.toISOString() ?? null}
          lastReviewedBy={past[0]?.reviewedBy ?? null}
          now={new Date().toISOString()}
          activityAvailable={activity !== null}
        />
        {past.length ? (
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Reviews already on record</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {past.map((r) => (
                  <li key={r.id} className="text-xs">
                    <span className="font-medium text-foreground">
                      {r.completedAt.toISOString().slice(0, 10)}
                    </span>{' '}
                    <span className="text-muted-foreground">
                      — {r.summary}
                      {r.reviewedBy ? ` · certified by ${r.reviewedBy}` : ' · reviewer not recorded'}
                    </span>
                    {r.applied.some((a) => !a.ok) ? (
                      <span className="ml-1 text-amber-700 dark:text-amber-500">
                        · {r.applied.filter((a) => !a.ok).length} decision(s) did not apply
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PageFrame>
  );
}
