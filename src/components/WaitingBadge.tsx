'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Count {
  available: boolean;
  waiting?: number;
  oldestDays?: number;
}

// ─── The count that tells someone work arrived ───────────────────────────────────────────────────────
//
// Nothing in the product told a person a case was waiting on them. Output sinks deliver results; nothing
// told a HUMAN they were needed, so finding out meant remembering to look — and cases sat for ten days.
//
// This is the in-console half of that: a count in the nav, visible from every page. It is not a
// substitute for an out-of-band nudge (a person not logged in still learns nothing), and that gap is
// recorded rather than papered over.
export function WaitingBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState<Count | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const res = await fetch('/api/v1/admin/my-work/count', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as Count;
        if (!cancelled) setCount(data);
      } catch {
        /* transient — keep the last known count rather than flashing an empty badge */
      }
    };
    void read();
    // Re-read on a slow tick. Work arriving is not a per-second event, and a chatty poll in the shell
    // would cost every page in the console.
    const timer = setInterval(read, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Re-read when the route changes too: deciding a case should make the badge drop immediately.
  }, [pathname]);

  // No badge when nothing is waiting, and none when the read failed — a zero we cannot stand behind
  // would tell someone nothing needs them, which is the one wrong answer here.
  if (!count?.available || !count.waiting) return null;

  const stale = (count.oldestDays ?? 0) >= 2;
  return (
    <span
      aria-label={`${count.waiting} cases waiting for a decision`}
      title={
        stale
          ? `${count.waiting} waiting — the oldest has been there ${count.oldestDays} days`
          : `${count.waiting} waiting for a decision`
      }
      className={`ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
        stale
          ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400'
          : 'bg-primary/15 text-primary'
      }`}
    >
      {count.waiting > 99 ? '99+' : count.waiting}
    </span>
  );
}
