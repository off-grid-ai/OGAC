'use client';

import LibraryThemeToggle from '@offgrid/ui/operator/theme-toggle';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

// The library's SmoothUI theme toggle, set up exactly as the website sets it up (sun-moon, small,
// no "system" option), controlled by next-themes so the choice persists the console's way.
// Until mount the theme is unknown, so it renders light, which is the console default.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <span className="theme-ctl">
      <LibraryThemeToggle
        variant="sun-moon"
        size="sm"
        showSystem={false}
        theme={mounted && resolvedTheme === 'dark' ? 'dark' : 'light'}
        onThemeChange={(next) => setTheme(next)}
      />
    </span>
  );
}
