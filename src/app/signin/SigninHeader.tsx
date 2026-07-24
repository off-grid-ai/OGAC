import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';

// The signin page top bar. The landing renders its own dark-terminal Nav (local to page.tsx); the
// signin page is on the token-driven console theme, so this uses design tokens (bg-background,
// border-border, text-foreground) instead of hardcoded colors, and keeps light/dark working via the
// shared ThemeToggle. Kept minimal and consistent with the docs shell header: the wordmark + logo on
// the left, the theme toggle on the right. Menlo mono for the "OGAC" product tag matches the brand.
export function SigninHeader() {
  return (
    <header className="sticky top-0 z-10 w-full border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[110rem] items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="Off Grid AI" width={26} height={26} priority />
          <span className="text-sm font-medium text-foreground">Off Grid AI</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground sm:inline">
            OGAC
          </span>
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
