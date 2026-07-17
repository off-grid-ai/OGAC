'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SubNav } from '@/components/nav/SubNav';
import { isModuleEnabled } from '@/lib/modules';
import { cn } from '@/lib/utils';
import { CANONICAL_OWNERS, IA_SECTIONS, type IaSectionId } from '@/modules/ownership';

/** One renderer for all eight canonical sections, backed by the ownership registry. */
export function SectionNav({ section }: Readonly<{ section: IaSectionId }>) {
  const pathname = usePathname();
  const definition = IA_SECTIONS.find((candidate) => candidate.id === section);
  const owners = CANONICAL_OWNERS.filter(
    (owner) => owner.section === section && isModuleEnabled(owner.gate),
  );

  if (!definition || owners.length < 2) return null;

  const active = owners
    .filter((owner) => pathname === owner.route || pathname.startsWith(`${owner.route}/`))
    .sort((a, b) => b.route.length - a.route.length)[0]?.id;

  return (
    <SubNav>
      <nav
        className="flex flex-wrap items-center gap-1"
        aria-label={`${definition.label} navigation`}
      >
        <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">
          {definition.label}
        </span>
        {owners.map((owner) => (
          <Link
            key={owner.id}
            href={owner.route}
            aria-current={active === owner.id ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1 text-sm transition-colors',
              active === owner.id
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {owner.label}
            {owner.comingSoon ? (
              <span className="ml-1.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">
                Soon
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
    </SubNav>
  );
}
