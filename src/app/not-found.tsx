import { House, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';

// Root 404. Renders inside the root layout (html/body/theme). Any unmatched route — or a
// notFound() from a disabled module / missing record — lands here instead of a bare Next default.
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <MagnifyingGlass className="size-6" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            That route doesn&apos;t exist, or the module isn&apos;t enabled for this deployment.
          </p>
        </div>
        <Link
          href="/overview"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <House className="size-4" />
          Go to overview
        </Link>
      </div>
    </div>
  );
}
