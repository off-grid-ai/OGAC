import { ArrowLeft, ArrowRight } from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { BlurFade } from '@/components/ui/blur-fade';
import { BorderBeam } from '@/components/ui/border-beam';
import { Button } from '@/components/ui/button';
import { MagicCard } from '@/components/ui/magic-card';
import { ARCH, getPhase } from '@/lib/architecture';

export const dynamic = 'force-dynamic';

export default async function PhasePage({ params }: Readonly<{ params: Promise<{ phase: string }> }>) {
  const { phase } = await params;
  const p = getPhase(phase);
  if (!p) notFound();

  const idx = ARCH.findIndex((x) => x.id === p.id);
  const prev = idx > 0 ? ARCH[idx - 1] : null;
  const next = idx < ARCH.length - 1 ? ARCH[idx + 1] : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Off Grid AI Console
          </Link>
          <Button asChild size="sm">
            <Link href="/operations/devices">Open console</Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-16">
        <BlurFade inView>
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            Phase {p.n}
          </Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{p.name}</h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">{p.blurb}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              In Off Grid AI
            </span>
            {p.maps.map((m) => (
              <Badge key={m} variant="secondary">
                {m}
              </Badge>
            ))}
          </div>
        </BlurFade>

        <BlurFade inView>
          <div className="relative mt-8 overflow-hidden rounded-xl border border-border bg-[#ffffff] p-3 shadow-sm">
            <Image
              src={`/diagrams/${p.hero}.jpg`}
              alt={`${p.name} reference architecture`}
              width={1150}
              height={641}
              className="h-auto w-full rounded-lg"
              priority
            />
            <BorderBeam duration={10} size={320} colorFrom="#34d399" colorTo="#059669" />
          </div>
        </BlurFade>

        <h2 className="mt-16 text-xl font-semibold tracking-tight">Components</h2>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {p.components.map((c, i) => (
            <BlurFade key={c.name} delay={0.03 * i} inView className="h-full">
              <MagicCard
                gradientFrom="#34d399"
                gradientTo="#059669"
                gradientColor="rgba(52,211,153,0.12)"
                gradientOpacity={0.5}
                className="h-full rounded-xl border border-border p-5 shadow-sm"
              >
                <h3 className="text-sm font-medium text-foreground">{c.name}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{c.job}</p>
              </MagicCard>
            </BlurFade>
          ))}
        </div>

        <h2 className="mt-16 text-xl font-semibold tracking-tight">Open-source options</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {p.oss.map((t) => (
            <Badge key={t} variant="secondary" className="text-sm">
              {t}
            </Badge>
          ))}
        </div>

        {p.diagrams.length > 1 ? (
          <>
            <h2 className="mt-16 text-xl font-semibold tracking-tight">Gallery</h2>
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {p.diagrams.slice(1).map((d, i) => (
                <BlurFade key={d} delay={0.04 * i} inView>
                  <div className="overflow-hidden rounded-xl border border-border bg-[#ffffff] p-3 shadow-sm">
                    <Image
                      src={`/diagrams/${d}.jpg`}
                      alt={`${p.name} detail`}
                      width={1150}
                      height={641}
                      className="h-auto w-full rounded-lg"
                    />
                  </div>
                </BlurFade>
              ))}
            </div>
          </>
        ) : null}

        <div className="mt-16 flex items-center justify-between border-t border-border pt-8">
          {prev ? (
            <Button asChild variant="ghost">
              <Link href={`/architecture/${prev.id}`}>
                <ArrowLeft className="size-4" />
                {prev.name}
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {next ? (
            <Button asChild variant="ghost">
              <Link href={`/architecture/${next.id}`}>
                {next.name}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          ) : (
            <span />
          )}
        </div>
      </div>
    </div>
  );
}
