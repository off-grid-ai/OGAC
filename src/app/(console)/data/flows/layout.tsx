import type { ReactNode } from 'react';
import { DataContextualShell } from '@/components/data/DataContextualShell';
import { FLOW_DESTINATIONS } from '@/lib/data-destinations';

export default function DataFlowsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <DataContextualShell moduleId="data-flows" destinations={FLOW_DESTINATIONS}>
      {children}
    </DataContextualShell>
  );
}
