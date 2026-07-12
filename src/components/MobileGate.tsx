import { DeviceMobile, Laptop } from '@phosphor-icons/react/dist/ssr';

// Console mobile block. The operator console is a desktop-first surface (wide tables, canvases,
// multi-column governance views) — it is NOT usable at phone width, so below the `md` breakpoint
// (< 768px) we render a full-screen "use a bigger screen" gate instead of a broken layout.
//
// CSS-only visibility (`md:hidden`): the gate is server-rendered and toggled purely by the viewport
// media query, so there is no JS/hydration flash and no client state. Tablets, laptops and desktops
// (≥ 768px) never see it. This is the console app only — the public landing/marketing site stays
// fully mobile-friendly.
export function MobileGate() {
  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 bg-background px-8 text-center md:hidden">
      <div className="flex items-center gap-3 text-primary">
        <DeviceMobile className="size-7" weight="duotone" aria-hidden />
        <span className="text-2xl leading-none text-muted-foreground">→</span>
        <Laptop className="size-8" weight="duotone" aria-hidden />
      </div>

      <div className="space-y-2">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-primary">
          Off Grid AI
        </p>
        <h1 className="text-lg font-semibold text-foreground">Open this on a bigger screen</h1>
      </div>

      <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
        The console is built for wide screens. Open it on a tablet, laptop, or desktop to run your
        platform — dashboards, pipelines, and governance don&apos;t fit a phone.
      </p>

      <div className="mt-2 rounded-md border border-border bg-card px-4 py-2 font-mono text-xs text-muted-foreground">
        Minimum width: 768px
      </div>
    </div>
  );
}
