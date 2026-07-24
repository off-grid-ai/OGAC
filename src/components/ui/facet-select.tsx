'use client';

// ─── FacetSelect — the ONE styled filter dropdown for URL-driven facets ─────────────────────────────
//
// Replaces native <select> popups with the app's dropdown-menu (Radix) so every facet filter looks
// and behaves like the rest of the console. It stays URL-driven per the nav rule: each option carries
// the href that applies it (computed server-side from the current filter, preserving every other
// facet + the query), so selection is a real navigation — deep-linkable and Back-coherent — not local
// component state. The trigger always shows the active option's label.

import { CaretDown } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface FacetSelectOption {
  value: string;
  label: string;
  href: string;
  selected: boolean;
}

export function FacetSelect({
  label,
  ariaLabel,
  options,
  className,
}: Readonly<{
  /** Short group heading shown at the top of the menu (e.g. "Audit state"). */
  label: string;
  /** Accessible name for the trigger (e.g. "Filter by audit recency"). */
  ariaLabel: string;
  options: readonly FacetSelectOption[];
  className?: string;
}>) {
  const router = useRouter();
  const active = useMemo(() => options.find((o) => o.selected) ?? options[0], [options]);
  const hrefByValue = useMemo(
    () => new Map(options.map((o) => [o.value, o.href] as const)),
    [options],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={ariaLabel}
          className={`w-full min-w-0 justify-between gap-2 font-normal ${className ?? ''}`}
        >
          <span className="truncate">{active?.label ?? ''}</span>
          <CaretDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
      >
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={active?.value ?? ''}
          onValueChange={(value) => {
            const href = hrefByValue.get(value);
            if (href) router.push(href);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value || '__all__'} value={option.value}>
              <span className="truncate">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
