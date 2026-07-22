import {
  ArrowSquareOut,
  CheckCircle,
  Database,
  ShieldCheck,
  UserCircle,
} from '@phosphor-icons/react/dist/ssr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ActionImpact } from '@/lib/action-contract';

/**
 * The plain-language contract shown before an enterprise action can run.
 *
 * This is deliberately a view model rather than the execution contract. The action service owns
 * policy and side effects; callers adapt its immutable decision into these serializable facts.
 */
export function ActionImpactSummary({
  impact,
  approver,
  evidence = [],
}: Readonly<{ impact: ActionImpact; approver?: string; evidence?: string[] }>) {
  return (
    <Card aria-label="Action impact" className="border-border shadow-sm">
      <CardHeader className="space-y-2 pb-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Before this runs
        </p>
        <CardTitle className="text-base leading-snug text-foreground">{impact.summary}</CardTitle>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4 md:grid-cols-2">
        <ImpactSection icon={<Database className="size-4" />} label="System change">
          <p className="text-sm text-foreground">{impact.system}</p>
          {impact.sideEffects.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              {impact.sideEffects.map((change) => (
                <li key={change} className="flex min-w-0 items-start gap-2">
                  <CheckCircle className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 break-words">{change}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No system fields change.</p>
          )}
        </ImpactSection>

        <ImpactSection
          icon={<ArrowSquareOut className="size-4" />}
          label="Data leaving your organization"
        >
          {!impact.egress.dataLeavesOrganisation ? (
            <p className="text-xs text-foreground">No data leaves your organization.</p>
          ) : (
            <p className="text-xs text-foreground">
              Action data crosses the organization boundary.
            </p>
          )}
        </ImpactSection>

        <ImpactSection icon={<UserCircle className="size-4" />} label="Approval">
          {impact.approval.required ? (
            <div className="space-y-1.5 text-xs">
              <p className="font-medium text-foreground">Approval required before execution.</p>
              <p className="text-muted-foreground">
                Maker-checker policy keeps the change paused until a different person approves it.
              </p>
              {approver ? (
                <p className="text-muted-foreground">
                  Can approve: <span className="text-foreground">{approver}</span>
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-foreground">No human approval is required.</p>
          )}
        </ImpactSection>

        <ImpactSection icon={<ShieldCheck className="size-4" />} label="Evidence retained">
          {evidence.length > 0 ? (
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {evidence.map((item) => (
                <li key={item} className="min-w-0 break-words">
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              The decision and execution result are retained.
            </p>
          )}
        </ImpactSection>
      </CardContent>
    </Card>
  );
}

function ImpactSection({
  icon,
  label,
  children,
}: Readonly<{
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}>) {
  return (
    <section className="min-w-0 border-t border-border pt-3" aria-label={label}>
      <h3 className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span className="text-primary" aria-hidden>
          {icon}
        </span>
        {label}
      </h3>
      {children}
    </section>
  );
}
