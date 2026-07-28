// ─── SigninTenantLinks — the way in to a live demo tenant from the apex signin page ─────────────────
//
// A visitor who reaches onprem-console.getoffgridai.co/signin with no account has nothing to do: the
// two read-only demos live on their own hosts (bharatunion-…, suraksha-…) and nothing on this page
// pointed at them. These links are that door.
//
// Destinations come from DEMO_TENANTS, the same source of truth the landing page's "See it live" CTA
// uses, so the two surfaces cannot drift to different URLs. Which tenants to show (if any) is the pure
// signinDemoTenants rule -  this component only renders what it is handed.

import { ArrowUpRight } from '@phosphor-icons/react/dist/ssr';
import type { DemoTenant } from '@/lib/demo-tenants';

export function SigninTenantLinks({ tenants }: Readonly<{ tenants: readonly DemoTenant[] }>) {
  if (tenants.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-center text-xs text-muted-foreground">
        Or look around a live one, read-only
      </p>
      <div className="grid grid-cols-2 gap-2">
        {tenants.map((t) => (
          <a
            key={t.slug}
            href={t.href}
            className="flex flex-col items-center gap-0.5 rounded-md border border-border bg-background px-2 py-2 no-underline transition-colors hover:border-primary/50 hover:bg-primary/[0.04]"
          >
            <span className="flex items-center gap-1 text-xs font-medium text-foreground">
              {t.name}
              <ArrowUpRight className="size-3 text-muted-foreground" />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {t.flavour}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
