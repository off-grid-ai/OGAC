import Link from 'next/link';
import { HANDBOOK } from '@/lib/handbook';

export const dynamic = 'force-dynamic';

export default function HandbookIndex() {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Handbook</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        How the Off Grid Console is built, integrated, and operated. The API reference lives at{' '}
        <a href="/docs" className="text-primary underline underline-offset-2">
          /docs
        </a>
        .
      </p>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {HANDBOOK.map((d) => (
          <Link
            key={d.slug}
            href={`/handbook/${d.slug}`}
            className="rounded-md border border-border p-4 hover:border-primary/50"
          >
            <div className="text-sm font-medium text-foreground">{d.title}</div>
            <p className="mt-1 text-xs text-muted-foreground">{d.blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
