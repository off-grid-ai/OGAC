import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { appRunHref } from '@/lib/action-outcome-routes';

export function OutcomeReadOnlyNotice({
  appId,
  runId,
}: Readonly<{ appId: string; runId: string }>) {
  const runHref = appRunHref(appId, runId);
  return (
    <div className="w-full space-y-5">
      <Link
        href={runHref}
        className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden /> Run
      </Link>
      <Card>
        <CardHeader>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Business result
          </p>
          <CardTitle className="text-base">This record is read-only for your role</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You can inspect the system receipt and recorded business results, but you cannot add,
          correct or withdraw them.
        </CardContent>
      </Card>
    </div>
  );
}
