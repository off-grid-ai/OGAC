import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function EvidenceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="governance-evidence">{children}</ContextualModuleShell>;
}
