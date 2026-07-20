import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function InsightsUsageLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="insights-usage">{children}</ContextualModuleShell>;
}
