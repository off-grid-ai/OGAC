import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function TrustLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="governance-trust">{children}</ContextualModuleShell>;
}
