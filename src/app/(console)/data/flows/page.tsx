import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const FLOW_TYPES = [
  {
    href: '/data/flows/replication',
    title: 'Replicated syncs',
    body: 'Move source data through managed connector syncs.',
  },
  {
    href: '/data/flows/orchestration',
    title: 'Orchestrated jobs',
    body: 'Run mapped, scheduled warehouse jobs and transformations.',
  },
] as const;

export default function DataFlowsPage() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {FLOW_TYPES.map((flow) => (
        <Link key={flow.href} href={flow.href}>
          <Card className="h-full transition-colors hover:border-primary/50">
            <CardHeader>
              <CardTitle className="text-base">{flow.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{flow.body}</CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
