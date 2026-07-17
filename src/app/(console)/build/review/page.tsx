import {
  ArrowRight,
  CheckCircle,
  Clock,
  ShieldCheck,
  UserCircle,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { auth } from '@/auth';
import { callerFromSession } from '@/lib/app-access-caller';
import { type AuthzSession } from '@/lib/authz';
import { requireModuleForUser } from '@/lib/module-access';
import { getReviewInbox } from '@/lib/review-inbox-reader';
import { currentOrgId } from '@/lib/tenancy';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// ─── Cross-app REVIEWER INBOX (HITL — screen 4, the queue) ────────────────────────────────────────
// One place a reviewer (a claims officer / manager / Head of Pricing) sees EVERY run awaiting THEIR
// decision, across all the apps they can approve — scoped by the per-app access policy + approval
// authority. Each item is a plain-language decision line with the amount/subject, who requested it,
// and when. Opening one goes to its deep-linkable review detail. Full-width, calm, scannable.
export default async function ReviewInboxPage() {
  await requireModuleForUser('studio');
  // The page is inside the (console) shell, which already gates the session; build the caller from it.
  const session = (await auth()) as AuthzSession | null;
  const orgId = await currentOrgId();
  const gate: AuthzSession = session ?? {
    user: { email: undefined, name: undefined, role: undefined },
  };
  const caller = await callerFromSession(gate, orgId);
  const items = await getReviewInbox(caller, orgId, 200);

  return (
    <PageFrame>
      {
        <div className="w-full space-y-6">
          <header className="flex items-start gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-500">
              <UserCircle className="size-5" weight="fill" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground">Your review queue</h1>
              <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
                Decisions waiting on you. Each one is a run an app has paused for a person to
                approve or reject. Open one to see what you&apos;re approving, why, and the amount
                at stake.
              </p>
            </div>
          </header>

          {/* At-a-glance count band. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Awaiting you" value={String(items.length)} tone="warn" />
            <Stat
              label="You can approve"
              value={String(items.filter((i) => i.canApprove).length)}
              tone="success"
            />
            <Stat
              label="Above your limit"
              value={String(items.filter((i) => !i.canApprove).length)}
              tone="neutral"
            />
            <Stat
              label="Apps involved"
              value={String(new Set(items.map((i) => i.appId)).size)}
              tone="neutral"
            />
          </div>

          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-border py-16 text-center">
              <CheckCircle className="size-9 text-primary" weight="fill" />
              <p className="text-sm font-medium text-foreground">You&apos;re all caught up.</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                No runs are waiting on your decision right now. When an app pauses for approval, it
                shows up here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <Link
                  key={item.runId}
                  href={`/build/review/${encodeURIComponent(item.runId)}`}
                  className="group flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.04] p-4 transition-colors hover:border-amber-500/70 hover:bg-amber-500/[0.07]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {item.appTitle}
                    </span>
                    {item.canApprove ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        <ShieldCheck className="size-3" weight="fill" /> You can approve
                      </span>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <Warning className="size-3" /> Above your limit
                      </span>
                    )}
                  </div>

                  <p className="text-[15px] font-semibold leading-snug text-foreground">
                    {item.question}
                  </p>

                  {item.amountLabel ? (
                    <p className="font-mono text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                      {item.amountLabel}
                    </p>
                  ) : null}

                  <div className="mt-auto flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" />
                      {item.startedAt ? new Date(item.startedAt).toLocaleString('en-US') : '—'}
                    </span>
                    {item.requestedBy ? <span>by {item.requestedBy}</span> : null}
                  </div>

                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 group-hover:underline dark:text-amber-500">
                    Review now <ArrowRight className="size-3" />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      }
    </PageFrame>
  );
}

function Stat({
  label,
  value,
  tone,
}: Readonly<{
  label: string;
  value: string;
  tone: 'warn' | 'success' | 'neutral';
}>) {
  let toneCls = 'text-foreground';
  if (tone === 'warn') toneCls = 'text-amber-600 dark:text-amber-500';
  else if (tone === 'success') toneCls = 'text-primary';
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
    </div>
  );
}
