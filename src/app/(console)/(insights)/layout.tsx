import type { ReactNode } from 'react';
import { InsightsNav } from '@/components/insights/InsightsNav';

// Shared layout for the Insights family (observability / analytics / drift / finops / reports /
// security events). The route group `(insights)` doesn't change any URL — it just lets these six
// pages share the scoped secondary-nav so they read as one connected operations surface, not six
// disconnected tiles. Each page keeps its own <h1> and content below the nav.
export default function InsightsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <InsightsNav />
      {children}
    </div>
  );
}
