'use client';

import { ArrowRight, Bank, ShieldCheck } from '@phosphor-icons/react';
import { type ComponentType } from 'react';
import { DEMO_TENANTS, demoTenantHref } from '@/lib/demo-tenants';
import { cn } from '@/lib/utils';
import { Magnetic } from '@/components/ui/magnetic';

// The core call to action: open a real, fully-seeded console and tour the whole product yourself.
// One card per industry (bank, insurer), each a validated https link to its read-only demo tenant.
// Copy + destinations come from the single source of truth (lib/demo-tenants). The two cards read
// as a paired invitation - "which one are you?" - not a generic "sign up".
const ICONS: Record<string, ComponentType<{ className?: string; weight?: 'bold' | 'duotone' }>> = {
  bank: Bank,
  insurer: ShieldCheck,
};

export function SeeItLive({ className }: { className?: string }) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2', className)}>
      {DEMO_TENANTS.map((tenant) => {
        const href = demoTenantHref(tenant.href);
        if (!href) return null;
        const Icon = ICONS[tenant.flavour] ?? Bank;
        return (
          <Magnetic key={tenant.slug} strength={0.18} className="w-full">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'group relative flex w-full min-h-[44px] items-center gap-4 overflow-hidden rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:p-5',
              )}
            >
              {/* Animated emerald gradient edge on hover - transform/opacity only. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-px rounded-xl bg-[linear-gradient(120deg,transparent,var(--og-primary),transparent)] bg-[length:200%_100%] opacity-0 transition-opacity duration-300 [mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)] [mask-composite:exclude] [padding:1px] group-hover:opacity-40 motion-safe:group-hover:animate-[shiny-text_2.4s_linear_infinite]"
              />
              <span className="relative flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-primary/10 text-primary">
                <Icon className="size-5" weight="duotone" />
              </span>
              <span className="relative flex-1">
                <span className="block font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {tenant.prompt}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  See it live
                  <ArrowRight
                    className="size-4 text-primary transition-transform duration-200 group-hover:translate-x-0.5"
                    weight="bold"
                  />
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {tenant.name} - a real, seeded console. Read-only. Tour every screen.
                </span>
              </span>
            </a>
          </Magnetic>
        );
      })}
    </div>
  );
}
