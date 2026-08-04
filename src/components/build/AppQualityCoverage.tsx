import { Info } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

export interface NotWatching {
  /** What is not covering this app. */
  name: string;
  /** Why not, in the owner's terms — never "not configured". */
  reason: string;
  href?: string;
}

// ─── What is NOT watching this app ───────────────────────────────────────────────────────────────────
//
// This began as an eight-cell matrix listing every QA capability with a badge — and it was wrong twice
// over, which the founder spotted immediately:
//
//  1. It repeated what the tab already showed. "Quality checks · ON THIS TAB · 3 attached" is not a
//     status; the reader is looking at the tab. Half the cells said "see above".
//  2. It contradicted the page. It counted 18 test cases from the raw rows while the section below
//     showed 7, because that one dedupes. Two numbers for one thing, on one screen — the exact defect
//     this codebase keeps catching, introduced by me.
//
// What actually carried information was the absences. An owner can see what IS watching their app by
// reading the tab; what they cannot see anywhere is what is NOT. So that is all this says now, in one
// line each, and it disappears entirely when nothing is missing.
export function AppQualityCoverage({ items }: Readonly<{ items: NotWatching[] }>) {
  if (items.length === 0) return null;

  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-1.5 py-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Info className="size-3.5 text-muted-foreground" />
          Not watching this app
        </p>
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.name} className="text-xs text-muted-foreground">
              <span className="text-foreground">{i.name}</span> — {i.reason}
              {i.href ? (
                <>
                  {' '}
                  <Link href={i.href} className="text-primary underline">
                    open it
                  </Link>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
