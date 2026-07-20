import type { ReactNode } from 'react';
import { ContextualModuleShell } from '@/components/nav/ContextualModuleShell';

export default function ModelsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ContextualModuleShell moduleId="runtime-models">{children}</ContextualModuleShell>;
}
