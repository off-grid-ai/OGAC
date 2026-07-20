import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function PoliciesLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="governance-policies">{children}</ContextualModuleShell>;
}
