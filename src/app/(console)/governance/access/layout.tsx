import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function AccessLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="governance-access">{children}</ContextualModuleShell>;
}
