'use client';

import { ArrowRight, Compass, X } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { CopilotAnswerView } from '@/components/copilot/CopilotAnswerView';
import { MIN_QUESTION_LENGTH, useCopilotAnswer } from '@/components/copilot/useCopilotAnswer';
import { useIsViewer } from '@/components/ViewerModeProvider';
import {
  GUIDE_THEMES,
  guideQuestionsForTenant,
  resolveGuideDestinations,
  type GuideDestination,
  type GuideResolution,
} from '@/lib/guide-copilot';
import { publicLabel } from '@/lib/lineage-labels';

// ─── THE GUIDE — a floating "show me around" copilot for an unguided visitor ───────────────────────
//
// WHY. Public demo links go to investors, angels and founders on read-only accounts. The 2026-08-05
// viewer audit watched that happen: the screens are real, but a stranger arriving alone has to guess
// what to click, and the good evidence (a full governed run, the decision queue, the regulator packs)
// is buried three levels down. This is the way in — ask a question in your own words, get an answer
// over the live records, and get taken to the screen that proves it.
//
// WHY IT ONLY EVER NAVIGATES. This audience cannot write; the same audit reproduced the cost of
// forgetting that (an armed "Add PostgreSQL" form → submit → a bare "Failed to add connector" toast).
// So the only action this widget offers is going somewhere, and `isReadOnlySafeHref` in the pure lib
// keeps a write-shaped route out of the table.
//
// WHY THE DESTINATION LOGIC IS NOT IN HERE. `resolveGuideDestinations` is pure and lives in
// src/lib/guide-copilot.ts, where a unit test asserts every href it can emit is a route that actually
// exists. A dead "Take me there" is worse than no copilot, and that is not something you can assert
// about a component.
//
// WHY open/closed IS LOCAL STATE. The repo rule is that a navigational POSITION lives in the URL, and
// every destination here is a real `router.push`. The launcher itself is an affordance, not a place —
// the same call ⌘K (GlobalSearch) makes. It survives navigation for free because the console layout
// stays mounted across a client-side push, so "take me there" keeps the guide open on the new screen.

// WHY A SIDE PANEL AND NOT A FLOATING CARD. It was a 26rem card pinned to the bottom-right corner,
// capped at 38rem tall. These answers are long — a conclusion, then an evidence list of eight to ten
// cited records — so the useful part was always scrolled out of a box the size of a support widget, and
// the citation list underneath it never had room to sit beside the claim it supports. A full-height
// rail gives the answer a real reading column and keeps the "go and see it" destinations visible at the
// same time, which is the entire point of the surface.
//
// Width is capped in BOTH directions on purpose: wide enough for the evidence list, but `42vw` so it
// never eats the screen it is pointing at — a visitor needs to see the console behind it to follow
// "take me there".
const PANEL_WIDTH = 'w-[min(34rem,42vw)]';

export function GuideCopilot({ tenantSlug }: Readonly<{ tenantSlug: string | null }>) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [question, setQuestion] = useState('');
  const [resolution, setResolution] = useState<GuideResolution | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const isViewer = useIsViewer();
  const { loading, result, error, ask, reset } = useCopilotAnswer();

  const questions = useMemo(() => guideQuestionsForTenant(tenantSlug), [tenantSlug]);

  // Something typed, but not yet enough for `submit` to accept it. Drives the composer hint so the
  // "enter to ask" affordance never claims to work when it will not.
  const trimmed = question.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUESTION_LENGTH;

  const submit = useCallback(
    (q: string) => {
      const text = q.trim();
      if (text.length < MIN_QUESTION_LENGTH) return;
      setAsked(text);
      // Destinations resolve instantly and locally — the visitor gets somewhere to go before the model
      // has finished thinking, which matters because a governed answer takes real seconds.
      setResolution(resolveGuideDestinations(text, { tenantSlug, sanitize: publicLabel }));
      void ask(text);
    },
    [ask, tenantSlug],
  );

  const goTo = useCallback(
    (destination: GuideDestination) => {
      // Navigation lives in the URL: a push, so Back steps out and the destination is shareable.
      router.push(destination.href);
    },
    [router],
  );

  const startOver = useCallback(() => {
    setAsked(null);
    setResolution(null);
    setQuestion('');
    reset();
  }, [reset]);

  if (dismissed) return null;

  return (
    // Hidden below `md`: the console already shows a "use a bigger screen" gate there, and a launcher
    // floating over that gate would be the one thing on top of an otherwise deliberate dead end.
    <>
      {open ? (
        <section
          aria-label="Guide"
          // Entrance uses the shared motion layer in globals.css (`animate-in` + the slide/fade
          // utilities), not a bespoke keyframe — so it inherits the app's easing tokens and the global
          // `prefers-reduced-motion` opt-out for free.
          className={`fixed inset-y-0 right-0 z-40 hidden flex-col border-l border-border bg-background shadow-2xl animate-in slide-in-from-right fade-in-0 md:flex ${PANEL_WIDTH}`}
        >
          {/* Header */}
          {/* COLOUR DISCIPLINE. This surface previously carried emerald in four places at once — the
              icon, the title, every section heading and the button — which reads as a green box rather
              than a terminal surface with an accent. The brand rule is emerald ON black/white, one
              accent per surface. Structure is now carried by borders and `muted-foreground`; emerald is
              reserved for the icon and the single primary action. */}
          <header className="flex items-start gap-3 border-b border-border bg-card px-5 py-4">
            <Compass className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] uppercase tracking-widest text-foreground">Guide</p>
              <p className="mt-0.5 text-[13px] leading-snug text-foreground/80">
                Ask what you want to know. Every answer comes with a screen you can go and check it on.
              </p>
            </div>
            {/* X collapses back to the launcher — the affordance a panel is expected to have. Dismissing
                it for the whole session is a separate, deliberately quieter control in the footer. */}
            <button
              type="button"
              aria-label="Close the guide"
              onClick={() => setOpen(false)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </header>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {isViewer ? (
              <p className="mb-3 rounded border border-border bg-muted/50 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
                You are signed in to look around. Nothing you click here can change anything.
              </p>
            ) : null}

            {asked ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-medium leading-snug text-foreground">{asked}</p>
                  <button
                    type="button"
                    onClick={startOver}
                    className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
                  >
                    new
                  </button>
                </div>

                {resolution ? <Destinations resolution={resolution} onGo={goTo} /> : null}

                {loading ? (
                  <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                    Reading the live records…
                  </p>
                ) : null}
                {error ? (
                  <p className="border-t border-border pt-3 text-xs text-destructive">{error}</p>
                ) : null}
                {result ? (
                  <div className="og-fade-in border-t border-border pt-3">
                    <CopilotAnswerView result={result} />
                  </div>
                ) : null}

                {resolution?.match === 'none' && !loading ? (
                  <Starters questions={questions} onPick={submit} heading="Try one of these instead" />
                ) : null}
              </div>
            ) : (
              <Starters questions={questions} onPick={submit} heading={null} />
            )}
          </div>

          {/* Composer — the one deliberately narrow element on the surface: a single focused input. */}
          <footer className="border-t border-border px-5 py-4">
            <textarea
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit(question);
                }
              }}
              rows={2}
              placeholder="Ask anything — e.g. what stops a bad answer reaching a customer?"
              className="w-full resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              {/* "Enter to ask" was a LIE for a short question. `submit` returns early below
                  MIN_QUESTION_LENGTH, so typing "Hi" and pressing Enter did nothing at all and the
                  only signal was the Ask button sitting at 40% opacity — which reads as styling, not
                  as a rejection. Say which state we are in instead of failing silently. */}
              <span
                className={`font-mono text-[10px] uppercase tracking-widest ${tooShort ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {tooShort ? 'a few more characters' : 'enter to ask'}
              </span>
              <button
                type="button"
                onClick={() => submit(question)}
                disabled={loading || question.trim().length < MIN_QUESTION_LENGTH}
                className="rounded border border-primary bg-primary px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {loading ? 'thinking' : 'ask'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              hide for this visit
            </button>
          </footer>
        </section>
      ) : null}

      {/* Launcher — only while the panel is closed. Keeping it visible alongside an open rail put two
          controls for the same thing on screen at once, and it would sit on top of the composer. */}
      {open ? null : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setTimeout(() => inputRef.current?.focus(), 60);
          }}
          aria-expanded={false}
          // Hidden below `md`: the console already shows a "use a bigger screen" gate there, and a
          // launcher floating over that gate would be the one thing on top of a deliberate dead end.
          className="fixed bottom-4 right-4 z-40 hidden items-center gap-2 rounded-full border border-primary bg-primary px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest text-primary-foreground shadow-lg transition-opacity hover:opacity-90 md:flex"
        >
          <Compass className="size-4" />
          Show me around
        </button>
      )}
    </>
  );
}

/** The "take me there" list. The whole point of the widget — a real route per answer. */
function Destinations({
  resolution,
  onGo,
}: Readonly<{ resolution: GuideResolution; onGo: (d: GuideDestination) => void }>) {
  if (resolution.destinations.length === 0) {
    // Honest degrade. The one thing this must never do is guess a page: a stranger sent to a screen
    // that does not answer their question learns that the product is confusing, not that it is deep.
    return (
      <p className="rounded border border-border bg-muted/40 px-2.5 py-2 text-xs leading-snug text-muted-foreground">
        There is no single screen that answers that one. Nothing below is a guess.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {resolution.match === 'index' ? (
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Closest matches
        </p>
      ) : (
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Go and see it
        </p>
      )}
      {resolution.destinations.map((d, i) => (
        <button
          key={`${d.href}-${d.label}`}
          type="button"
          onClick={() => onGo(d)}
          style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}
          className="og-rise group block w-full rounded border border-border bg-card px-3 py-2.5 text-left transition-colors duration-150 hover:border-primary hover:bg-muted/60"
        >
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
            {d.label}
            <ArrowRight className="size-3 text-primary transition-transform group-hover:translate-x-0.5" />
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
            {d.what}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Starter questions, grouped so a visitor can find their theme rather than face an empty box. */
function Starters({
  questions,
  onPick,
  heading,
}: Readonly<{
  questions: ReturnType<typeof guideQuestionsForTenant>;
  onPick: (q: string) => void;
  heading: string | null;
}>) {
  return (
    <div className="space-y-3">
      {heading ? (
        <p className="border-t border-border pt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {heading}
        </p>
      ) : null}
      {GUIDE_THEMES.map((theme) => {
        const items = questions.filter((q) => q.theme === theme.id);
        if (items.length === 0) return null;
        return (
          <div key={theme.id} className="space-y-1">
            {/* Neutral, not emerald: three of these stack vertically, so an accent on each turned the
                list into a green ladder with nothing for the eye to land on. */}
            <p className="border-b border-border/60 pb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {theme.label}
            </p>
            {items.map((q, i) => (
              // CONTRAST: these questions are the CONTENT of the panel, so they are `text-foreground`.
              // Rendering them in `muted-foreground` (as they were) put every readable thing on the
              // surface in light grey and the whole panel read as washed out and disabled — removing
              // the emerald overload is only half the fix; the remaining text has to carry the
              // hierarchy. Emerald returns on hover only, as the affordance that this is clickable.
              //
              // Stagger via inline animation-delay is the cheap pattern globals.css sanctions for a
              // single hero region. Capped at 6 steps so a long list never feels like it is loading.
              <button
                key={q.id}
                type="button"
                onClick={() => onPick(q.question)}
                style={{ animationDelay: `${Math.min(i, 6) * 25}ms` }}
                className="og-rise block w-full rounded border border-transparent px-2 py-1.5 text-left text-[12.5px] leading-snug text-foreground transition-colors duration-150 hover:border-border hover:bg-muted/60 hover:text-primary"
              >
                {q.question}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
