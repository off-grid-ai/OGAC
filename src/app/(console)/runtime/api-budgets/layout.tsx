import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function ApiBudgetsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="runtime-api-budgets">{children}</ContextualModuleShell>;
}
