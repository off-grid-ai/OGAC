import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const FLOW_TYPES = [
  { href: '/data/flows/replication', title: 'Replicated syncs', body: 'Move source data through managed connector syncs.' },
  { href: '/data/flows/orchestration', title: 'Orchestrated jobs', body: 'Run mapped, scheduled warehouse jobs and transformations.' },
] as const;

export default function DataFlowsPage() {
  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Data flows</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Replication and orchestration share one data-movement home while retaining their real lifecycles.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {FLOW_TYPES.map((flow) => (
          <Link key={flow.href} href={flow.href}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader><CardTitle className="text-base">{flow.title}</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">{flow.body}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
