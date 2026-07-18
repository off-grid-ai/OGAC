import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function InsightsAiLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="insights-ai">{children}</ContextualModuleShell>;
}
