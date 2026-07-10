import { ArrowRight, GithubLogo } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

// The primary + secondary call to action, reused at the hero and the close so the two
// stay in lockstep (one place to change the copy or the destinations).
export function CtaButtons({ githubLabel = 'GitHub' }: { githubLabel?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90">
        <Link href="/overview">
          Open the console
          <ArrowRight className="size-4" weight="bold" />
        </Link>
      </Button>
      <Button asChild size="lg" variant="outline">
        <a href="https://github.com/off-grid-ai/console" target="_blank" rel="noopener noreferrer">
          <GithubLogo className="size-4" />
          {githubLabel}
        </a>
      </Button>
    </div>
  );
}
