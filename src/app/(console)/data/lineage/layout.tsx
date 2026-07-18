import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function LineageLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="data-lineage">{children}</ContextualModuleShell>;
}
