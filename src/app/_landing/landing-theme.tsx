'use client';

import { useTheme } from 'next-themes';
import { useEffect } from 'react';

// The landing's first impression is the dark terminal look. The console app defaults to
// light, so on the FIRST visit (no stored preference) we set the landing to dark; a visitor
// who has already chosen a theme (via the toggle here or the console's settings) keeps it.
// `next-themes` persists the choice under localStorage["theme"]; we only act when it is unset.
export function LandingThemeDefault() {
  const { setTheme } = useTheme();
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem('theme');
    } catch {
      stored = null;
    }
    if (!stored) setTheme('dark');
  }, [setTheme]);
  return null;
}
