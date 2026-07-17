import type { ReactNode } from 'react';

export default function RuntimeLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
