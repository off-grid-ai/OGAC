import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// A small navigational card for a section-overview "management roots" grid: title + one-line purpose,
// the whole card links into the module. Pure presentation, reused by the Governance + Insights homes.
export interface ModuleLink {
  title: string;
  href: string;
  description: string;
}

export function ModuleCard({ title, href, description }: Readonly<ModuleLink>) {
  return (
    <Link href={href} className="block">
      <Card className="h-full shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/30">
        <CardHeader className="pb-1.5">
          <CardTitle className="text-sm">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
