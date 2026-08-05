'use client';

import { ArrowRight, CaretDown, Compass, X } from '@phosphor-icons/react/dist/ssr';
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

const PANEL_MAX_HEIGHT = 'max-h-[min(38rem,calc(100vh-8rem))]';

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
    <div className="pointer-events-none fixed bottom-0 right-0 z-40 hidden flex-col items-end gap-2 p-4 md:flex">
      {open ? (
        <section
          aria-label="Guide"
          className={`pointer-events-auto flex w-[26rem] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl ${PANEL_MAX_HEIGHT}`}
        >
          {/* Header */}
          <header className="flex items-start gap-3 border-b border-border bg-muted/40 px-4 py-3">
            <Compass className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] uppercase tracking-widest text-primary">Guide</p>
              <p className="mt-0.5 text-[13px] leading-snug text-foreground">
                Ask what you want to know. Every answer comes with a screen you can go and check it on.
              </p>
            </div>
            <button
              type="button"
              aria-label="Collapse the guide"
              onClick={() => setOpen(false)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <CaretDown className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Close the guide"
              onClick={() => setDismissed(true)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </header>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
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
                  <div className="border-t border-border pt-3">
                    <CopilotAnswerView result={result} compact />
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
          <footer className="border-t border-border px-4 py-3">
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
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                enter to ask
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
          </footer>
        </section>
      ) : null}

      {/* Launcher — obvious on arrival, one click to collapse, one to dismiss for good. */}
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) setTimeout(() => inputRef.current?.focus(), 60);
        }}
        aria-expanded={open}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-primary bg-primary px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest text-primary-foreground shadow-lg transition-opacity hover:opacity-90"
      >
        <Compass className="size-4" />
        {open ? 'Hide guide' : 'Show me around'}
      </button>
    </div>
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
      {resolution.destinations.map((d) => (
        <button
          key={`${d.href}-${d.label}`}
          type="button"
          onClick={() => onGo(d)}
          className="group block w-full rounded border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-muted/60"
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
            <p className="font-mono text-[10px] uppercase tracking-widest text-primary">
              {theme.label}
            </p>
            {items.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => onPick(q.question)}
                className="block w-full rounded border border-transparent px-2 py-1.5 text-left text-[12.5px] leading-snug text-muted-foreground transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground"
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
