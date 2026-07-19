import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function NodesDirectoryLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="operations-nodes">{children}</ContextualModuleShell>;
}
