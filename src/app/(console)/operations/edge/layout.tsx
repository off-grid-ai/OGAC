import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function EdgeLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="operations-edge">{children}</ContextualModuleShell>;
}
