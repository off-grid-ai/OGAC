import type { ReactNode } from 'react';
export default function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
