'use client';

import { ArrowRight, GithubLogo } from '@phosphor-icons/react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Magnetic } from '@/components/ui/magnetic';

// The primary + secondary call to action, reused at the hero and the close so the two stay in
// lockstep (one place to change the copy or the destinations). The primary is magnetic (hover
// intent); both keep >=44px tap targets and read correctly in both themes via semantic tokens.
export function CtaButtons({ githubLabel = 'GitHub' }: { githubLabel?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Magnetic strength={0.25}>
        <Button
          asChild
          size="lg"
          className="group bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Link href="/overview">
            Open the console
            <ArrowRight
              className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
              weight="bold"
            />
          </Link>
        </Button>
      </Magnetic>
      <Button asChild size="lg" variant="outline">
        <a href="https://github.com/off-grid-ai/console" target="_blank" rel="noopener noreferrer">
          <GithubLogo className="size-4" />
          {githubLabel}
        </a>
      </Button>
    </div>
  );
}
