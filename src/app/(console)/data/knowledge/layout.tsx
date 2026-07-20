import type { ReactNode } from 'react';
import { DataContextualShell } from '@/components/data/DataContextualShell';
import { KNOWLEDGE_DESTINATIONS } from '@/lib/data-destinations';

export default function KnowledgeLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <DataContextualShell moduleId="data-knowledge" destinations={KNOWLEDGE_DESTINATIONS}>
      {children}
    </DataContextualShell>
  );
}
