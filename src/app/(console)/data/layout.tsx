import type { ReactNode } from 'react';
import { DataNav } from '@/components/data/DataNav';

// Shared layout for the Data family (integrations / data / retrieval / lineage). The `(data)` route
// group doesn't change any URL — it lets these pages share the scoped secondary-nav so the data
// plane reads as one connected experience, in the order data moves. Each page keeps its own heading
// and content below the nav.
export default function DataLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <DataNav />
      {children}
    </div>
  );
}
