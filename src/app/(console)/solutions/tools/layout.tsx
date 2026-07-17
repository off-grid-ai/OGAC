import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function ToolsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="solutions-tools">{children}</ContextualModuleShell>;
}
