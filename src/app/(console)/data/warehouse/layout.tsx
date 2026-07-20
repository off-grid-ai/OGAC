import type { ReactNode } from 'react';
import { DataContextualShell } from '@/components/data/DataContextualShell';
import { WAREHOUSE_DESTINATIONS } from '@/lib/data-destinations';

export default function WarehouseLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <DataContextualShell moduleId="data-warehouse" destinations={WAREHOUSE_DESTINATIONS}>
      {children}
    </DataContextualShell>
  );
}
