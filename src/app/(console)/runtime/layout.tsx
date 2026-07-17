import type { ReactNode } from 'react';
import { RuntimeNav } from '@/components/runtime/RuntimeNav';

export default function RuntimeLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="w-full space-y-6">
      <RuntimeNav />
      {children}
    </div>
  );
}
