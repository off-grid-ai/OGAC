import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function ConfigurationLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ContextualModuleShell moduleId="operations-configuration">{children}</ContextualModuleShell>
  );
}
