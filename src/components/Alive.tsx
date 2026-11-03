'use client';

import { AliveProvider, LivingField } from '@offgrid/ui/operator/alive';
import { type ReactNode, useEffect, useState } from 'react';

// The alive layer from the shared library, wired the way the website wires it: one conductor for
// the whole app (pointer light, entrances, press give on every card, button and field) and the
// living field fixed behind the page. The field mounts once the browser is idle after hydration,
// so it costs nothing on first paint. Narrow screens get a wider lattice (fewer dots).
function Field() {
  const [spacing, setSpacing] = useState(0);
  useEffect(() => {
    const go = () => setSpacing(matchMedia('(max-width: 860px)').matches ? 34 : 26);
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(go, { timeout: 1200 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(go, 300);
    return () => clearTimeout(id);
  }, []);
  return spacing ? <LivingField className="og-living-field" spacing={spacing} /> : null;
}

export function Alive({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div data-og-alive="" className="contents">
      <AliveProvider serverRendered>
        <Field />
        {children}
      </AliveProvider>
    </div>
  );
}
