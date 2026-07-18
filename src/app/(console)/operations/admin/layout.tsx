import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="operations-admin">{children}</ContextualModuleShell>;
}
