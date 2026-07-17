import type { ReactNode } from 'react';
import { OperationsNav } from '@/components/operations/OperationsNav';

export default function OperationsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="w-full space-y-6">
      <OperationsNav />
      {children}
    </div>
  );
}
