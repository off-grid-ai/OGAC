import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const EVIDENCE = [
  {
    href: '/governance/evidence/audit',
    title: 'Audit log',
    body: 'Accountability events and exports.',
  },
  {
    href: '/governance/evidence/security',
    title: 'Security events',
    body: 'Blocked, denied, and suspicious activity.',
  },
  {
    href: '/governance/evidence/provenance',
    title: 'Provenance',
    body: 'Verify signed answers and artifacts.',
  },
  {
    href: '/governance/evidence/export',
    title: 'Evidence export',
    body: 'Ship evidence to enterprise systems.',
  },
] as const;

export default function EvidencePage() {
  return (
    <div className="grid w-full gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {EVIDENCE.map((item) => (
        <Link key={item.href} href={item.href}>
          <Card className="h-full transition-colors hover:border-primary/50">
            <CardHeader>
              <CardTitle className="text-base">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{item.body}</CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
