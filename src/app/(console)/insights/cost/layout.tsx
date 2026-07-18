import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function InsightsCostLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="insights-cost">{children}</ContextualModuleShell>;
}
