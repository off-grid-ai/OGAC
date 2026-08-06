'use client';

import { ArrowRight, Warning } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { CopilotAnswerSkeleton } from '@/components/copilot/CopilotAnswerSkeleton';
import { isCurrentPath } from '@/lib/guide-copilot';
import { PROOF_UNAVAILABLE, type ProofPoint } from '@/lib/guide-proof';

// ─── "Prove it" — the claims, with live numbers, that a buyer needs settled ────────────────────────
//
// Deliberately NOT the chatbot. Every figure here is computed from the same readers that back the
// pages, so it renders instantly, it cannot hallucinate, and the one claim that matters most — "this
// is real software" — is not being made by the component least able to prove it.
//
// Each card is a claim, its number, and a link. The link is the point: a proof a reader cannot go and
// check for themselves is a slogan.

export function GuideProof({
  onGo,
  pathname,
}: Readonly<{ onGo: (href: string) => void; pathname: string | null }>) {
  const [points, setPoints] = useState<ProofPoint[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/v1/admin/guide/proof', { cache: 'no-store' });
        const body = (await r.json().catch(() => null)) as { points?: ProofPoint[] } | null;
        if (!alive) return;
        if (!r.ok || !body?.points) setFailed(true);
        else setPoints(body.points);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Warning className="mt-0.5 size-3.5 shrink-0" />
        {/* Says the read failed. An empty list here would read as "there is nothing to prove", which
            is the opposite of the truth and the worst possible thing for this surface to imply. */}
        <span>Could not read the live figures just now. Nothing below is a stored value.</span>
      </div>
    );
  }

  if (!points) return <CopilotAnswerSkeleton label="Reading the live figures…" />;

  return (
    <div className="space-y-2.5">
      <p className="text-[13px] leading-snug text-muted-foreground">
        Five things worth checking, each with a number read from this system right now — and the screen
        where you can see it for yourself.
      </p>
      {points.map((p, i) => (
        <div
          key={p.id}
          style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
          className="og-rise rounded-md border border-border bg-card p-3"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium leading-snug text-foreground">{p.claim}</span>
            {/* The figure carries the weight, so it gets the accent and the size. A claim with no
                number shows nothing here rather than a zero. */}
            {p.value !== null ? (
              <span className="shrink-0 font-mono text-base font-semibold text-primary">{p.value}</span>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {p.value !== null ? p.detail : PROOF_UNAVAILABLE}
          </p>
          {/* The action is a bordered pill, not a line of text with an arrow after it. The previous
              version read as a caption — nothing about 11px foreground text says "press me", and on a
              panel where going somewhere IS the point, the one control per card has to look like one.
              Suppressed entirely when it would point at the screen already open: a link that cannot
              move you is indistinguishable from a broken one. */}
          {isCurrentPath(p.href, pathname) ? (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              you are on this screen
            </p>
          ) : (
            <button
              type="button"
              onClick={() => onGo(p.href)}
              className="group mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors duration-150 hover:border-primary hover:bg-primary hover:text-primary-foreground"
            >
              {p.linkLabel}
              <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
