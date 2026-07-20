import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function SecretsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="governance-secrets">{children}</ContextualModuleShell>;
}
