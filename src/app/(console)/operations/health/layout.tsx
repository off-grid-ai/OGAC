import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function HealthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="operations-health">{children}</ContextualModuleShell>;
}
