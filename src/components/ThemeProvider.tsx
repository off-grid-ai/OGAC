'use client';

import { ThemeProvider as NextThemes } from 'next-themes';
import { type ReactNode } from 'react';

export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <NextThemes
      attribute="data-theme"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemes>
  );
}
