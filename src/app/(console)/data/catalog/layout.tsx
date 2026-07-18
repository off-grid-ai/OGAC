import type { ReactNode } from 'react';
import { DataContextualShell } from '@/components/data/DataContextualShell';
import { CATALOG_DESTINATIONS } from '@/lib/data-destinations';

export default function CatalogLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <DataContextualShell moduleId="data-catalog" destinations={CATALOG_DESTINATIONS}>
      {children}
    </DataContextualShell>
  );
}
