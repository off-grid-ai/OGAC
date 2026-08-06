'use client';

import { ArrowLeft, ArrowRight, ArrowUp, Compass, X } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CopilotAnswerSkeleton } from '@/components/copilot/CopilotAnswerSkeleton';
import { CopilotAnswerView } from '@/components/copilot/CopilotAnswerView';
import { MIN_QUESTION_LENGTH, useCopilotAnswer, type CopilotAnswer } from '@/components/copilot/useCopilotAnswer';
import { useIsViewer } from '@/components/ViewerModeProvider';
import {
  followUpQuestions,
  GUIDE_ROLES,
  guideQuestionsForTenant,
  guideRoleFromParam,
  guideRoleSpec,
  themesForRole,
  type GuideQuestion,
  type GuideRole,
  resolveGuideDestinations,
  withoutCurrentPage,
  type GuideDestination,
  type GuideResolution,
} from '@/lib/guide-copilot';
import { pageExplanationQuestion } from '@/lib/guide-events';
import { publicLabel } from '@/lib/lineage-labels';
import { routeIdentityForPath } from '@/modules/route-identity';

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
// The panel is RESIZABLE by dragging its left edge. Answers here range from a one-liner to a
// conclusion plus a ten-item evidence list, so no single width is right for all of them, and the
// reader is the only one who knows how much of the console behind it they still need to see.
//
// Width is a PREFERENCE, not a navigational position, so it lives in localStorage rather than the URL
// — the repo rule about putting position in the URL is about places you can navigate Back out of, and
// a panel width is not one. Open/closed is local for the same reason.
/** The guide answers two different questions; see the mode switch in the header. */
type GuideMode = 'tour' | 'page';

/** One answered question, kept so the reader can step back to it without paying for it again. */
interface GuideSnapshot {
  asked: string;
  resolution: GuideResolution | null;
  result: CopilotAnswer | null;
}

const PANEL_STORAGE_KEY = 'offgrid.guide.width';
/**
 * The reader's own open/closed choice, remembered across reloads.
 *
 * This replaces a "seen once" flag. That flag opened the panel on the very first page of the very
 * first visit and never again, so a reader who reloaded — or came back tomorrow — got a console with
 * the guide hidden behind a corner button, which is the exact situation the guide exists to prevent.
 * Remembering the CHOICE is the honest version of the same intent: open by default, closed if you
 * closed it, and it stays that way until you say otherwise.
 */
const GUIDE_OPEN_KEY = 'offgrid.guide.open';
/** "Hide for this visit" — sessionStorage, because a visit is a tab, not a browser installation. */
const GUIDE_DISMISSED_KEY = 'offgrid.guide.dismissed';
/** The reader's role, once they pick one. */
const GUIDE_ROLE_KEY = 'offgrid.guide.role';
const PANEL_MIN_PX = 380;
/** Never wider than 80% of the viewport: the point of this surface is pointing AT the console. */
const panelMaxPx = (viewport: number) => Math.max(PANEL_MIN_PX, Math.round(viewport * 0.8));
const PANEL_DEFAULT_PX = 544; // 34rem — the previous fixed width, now just the starting point.

export function clampPanelWidth(px: number, viewport: number): number {
  if (!Number.isFinite(px)) return PANEL_DEFAULT_PX;
  return Math.min(Math.max(Math.round(px), PANEL_MIN_PX), panelMaxPx(viewport));
}

export function GuideCopilot({ tenantSlug }: Readonly<{ tenantSlug: string | null }>) {
  // Starts CLOSED and opens on mount for a demo visitor (see the effect below), rather than starting
  // open — the server renders this too, and a panel that exists in the server HTML but not in the
  // client's first paint is a hydration mismatch.
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Who is reading. Absent until they say so — we never guess someone's job from their behaviour.
  const [role, setRole] = useState<GuideRole | null>(null);
  /** Every question asked this session, so a follow-up is never one they have already had. */
  const [history, setHistory] = useState<string[]>([]);
  const [question, setQuestion] = useState('');
  const [resolution, setResolution] = useState<GuideResolution | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const isViewer = useIsViewer();
  const { loading, result, error, ask, reset } = useCopilotAnswer();

  const questions = useMemo(() => guideQuestionsForTenant(tenantSlug), [tenantSlug]);

  // Panel width. Starts at the default so the server and first client render agree (a value read from
  // localStorage during render would hydrate-mismatch), then adopts the stored preference on mount.
  const [width, setWidth] = useState(PANEL_DEFAULT_PX);
  const dragging = useRef(false);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(PANEL_STORAGE_KEY));
    if (stored) setWidth(clampPanelWidth(stored, window.innerWidth));
  }, []);

  // OPEN ON ARRIVAL for a demo visitor, on every load — not once per browser. A stranger who lands
  // on an operator console alone has to guess what to click, which is the whole reason this surface
  // exists, and a panel hidden behind a corner button is a guess they have to make first. Operators
  // are left alone: they know the product and the panel would just take room from the screen they
  // came to use.
  //
  // The reader's own choice always wins. Closing it is remembered across reloads, so nobody has to
  // close it twice; only an absent preference means "open".
  // The LINK wins over the remembered choice: whoever sent `?as=ciso` knows who they sent it to,
  // and that is better information than a role this browser picked on some earlier visit.
  useEffect(() => {
    const fromLink = guideRoleFromParam(new URLSearchParams(window.location.search).get('as'));
    if (fromLink) {
      setRole(fromLink);
      window.localStorage.setItem(GUIDE_ROLE_KEY, fromLink);
      return;
    }
    setRole(guideRoleFromParam(window.localStorage.getItem(GUIDE_ROLE_KEY)));
  }, []);

  const chooseRole = useCallback((next: GuideRole | null) => {
    setRole(next);
    if (next) window.localStorage.setItem(GUIDE_ROLE_KEY, next);
    else window.localStorage.removeItem(GUIDE_ROLE_KEY);
  }, []);

  useEffect(() => {
    if (!isViewer) return;
    if (window.sessionStorage.getItem(GUIDE_DISMISSED_KEY)) {
      setDismissed(true);
      return;
    }
    setOpen(window.localStorage.getItem(GUIDE_OPEN_KEY) !== '0');
  }, [isViewer]);

  /** Open/close, remembered. Every close path goes through here so none of them can forget. */
  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    window.localStorage.setItem(GUIDE_OPEN_KEY, next ? '1' : '0');
  }, []);

  /** Hide for the rest of this visit: closes it too, so the shell stops leaving room for it. */
  const dismiss = useCallback(() => {
    window.sessionStorage.setItem(GUIDE_DISMISSED_KEY, '1');
    setDismissed(true);
    setOpen(false);
  }, []);

  // Tell the app shell how much room to leave, so the panel SHARES the screen instead of covering it
  // (globals.css turns these two into padding on [data-og-app-shell]). Driven from state rather than
  // set once on open, so dragging the handle moves the content in step. Cleared on close and on
  // unmount — a stale attribute would leave the console permanently indented against nothing.
  // `dismissed` is checked as well as `open`. "Hide for this visit" only set `dismissed`, and the
  // component returns null on it — but `open` was still true, so this effect happily kept the shell
  // indented and the console rendered with a wide empty gutter down the right-hand side, reserving
  // room for a panel that was no longer there.
  useEffect(() => {
    const root = document.documentElement;
    if (!open || dismissed) {
      root.removeAttribute('data-og-guide-open');
      return;
    }
    root.setAttribute('data-og-guide-open', '');
    root.style.setProperty('--og-guide-width', `${width}px`);
    return () => root.removeAttribute('data-og-guide-open');
  }, [dismissed, open, width]);

  /**
   * Drop the bottom fade once there is nothing below it.
   *
   * Also covers the case where the content simply FITS: scrollHeight === clientHeight satisfies this,
   * so a short list never wears a fade implying more content that does not exist.
   */
  const syncScrollFade = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.toggleAttribute('data-at-end', el.scrollHeight - el.scrollTop - el.clientHeight < 8);
  }, []);

  // Pointer events rather than mouse events so a trackpad, a mouse and a pen all work, and
  // setPointerCapture keeps the drag alive when the cursor outruns the 4px handle.
  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    // The panel is pinned right, so its width is the distance from the pointer to the right edge.
    setWidth(clampPanelWidth(window.innerWidth - e.clientX, window.innerWidth));
  }, []);

  const endResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      window.localStorage.setItem(PANEL_STORAGE_KEY, String(width));
    },
    [width],
  );

  const resetWidth = useCallback(() => {
    setWidth(PANEL_DEFAULT_PX);
    window.localStorage.setItem(PANEL_STORAGE_KEY, String(PANEL_DEFAULT_PX));
  }, []);

  // Something typed, but not yet enough for `submit` to accept it. Drives the composer hint so the
  // "enter to ask" affordance never claims to work when it will not.
  const trimmed = question.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUESTION_LENGTH;

  // TWO MODES. "Show me around" is the curated tour — a stranger who does not yet know what to ask.
  // "Explain this page" answers for wherever they actually are, which is the question people have
  // once they have clicked into something and want to know what they are looking at.
  const [mode, setMode] = useState<GuideMode>('tour');
  const pathname = usePathname();
  const identity = routeIdentityForPath(pathname);

  // ─── Back through previous answers ────────────────────────────────────────────────────────────
  //
  // Each answer costs real seconds on on-prem hardware, so asking a second question used to DESTROY
  // the first one with no way back — a reader who followed a "go and see it" link, then asked about
  // where they landed, could not return to what sent them there. Snapshots are kept in memory and
  // restored without re-asking, because re-running the model to see something already computed is
  // the expensive way to answer a question nobody asked again.
  const [past, setPast] = useState<GuideSnapshot[]>([]);
  const [restored, setRestored] = useState<GuideSnapshot | null>(null);

  const goBack = useCallback(() => {
    setPast((stack) => {
      if (stack.length === 0) return stack;
      setRestored(stack[stack.length - 1]);
      return stack.slice(0, -1);
    });
  }, []);

  const submit = useCallback(
    (q: string) => {
      const text = q.trim();
      if (text.length < MIN_QUESTION_LENGTH) return;
      // Keep whatever is on screen before replacing it. Snapshotting the RESTORED entry when one is
      // showing keeps the stack honest — otherwise stepping back and asking again would silently
      // drop the entry you were looking at.
      const current = restored ?? (asked ? { asked, resolution, result } : null);
      if (current?.asked) setPast((stack) => [...stack, current]);
      setRestored(null);
      // Clear the composer once the question is accepted. It used to keep the text, so after asking
      // you were left staring at your own question in the input while the answer rendered above it —
      // and typing the next one meant selecting and deleting the last one first. The question is not
      // lost: it is shown above the answer as the thing that was asked.
      setQuestion('');
      setAsked(text);
      setHistory((h) => (h.includes(text) ? h : [...h, text]));
      // Destinations resolve instantly and locally — the visitor gets somewhere to go before the model
      // has finished thinking, which matters because a governed answer takes real seconds.
      setResolution(resolveGuideDestinations(text, { tenantSlug, sanitize: publicLabel }));
      void ask(text);
    },
    [ask, asked, resolution, restored, result, tenantSlug],
  );

  // A restored snapshot wins over live state, so stepping back shows that answer rather than the
  // newest one. Loading is suppressed while viewing history — a spinner over an answer you already
  // have reads as though it is being recomputed.
  const shownAsked = restored ? restored.asked : asked;
  const rawResolution = restored ? restored.resolution : resolution;
  // Filtered against the CURRENT path, not the path at the time the question was asked. The reader
  // clicks "take me there", lands, and the list must stop offering the screen they are now on — a
  // filter applied once at submit time would leave exactly that dead link behind.
  const shownResolution = useMemo(
    () => (rawResolution ? withoutCurrentPage(rawResolution, pathname) : null),
    [pathname, rawResolution],
  );
  const shownResult = restored ? restored.result : result;
  const shownLoading = restored ? false : loading;

  const goTo = useCallback(
    (destination: GuideDestination) => {
      // Navigation lives in the URL: a push, so Back steps out and the destination is shareable.
      router.push(destination.href);
      // ...and the guide then reads the screen it just took you to.
      //
      // Taking someone somewhere and leaving the PREVIOUS answer sitting above the new page is the
      // one moment this surface can't afford to look inert: the reader followed an instruction, the
      // page changed underneath them, and nothing acknowledged it. A stranger reads that as "the
      // thing is broken", not "the answer above still applies".
      //
      // Asking about the destination reuses the whole existing pipeline — the same gather, the same
      // honesty labels, the same loader — so there is no second answer path to keep in step.
      //
      // NOT in page mode, though: there the pathname effect already asks about wherever you land, so
      // doing it here too fired TWO overlapping requests for one click. The hook now refuses to let a
      // superseded response land, but the right fix is not to make the second request at all.
      // No same-page branch any more. A destination pointing at the current screen used to be
      // handled here — asked about instead of navigated to — but handling a dead link gracefully is
      // not the same as not offering it. `withoutCurrentPage` removes it before the reader can click.
      if (mode !== 'page') {
        submit(`What am I looking at on ${destination.label}, and what should I check here?`);
      }
    },
    [identity, mode, pathname, router, submit],
  );

  const startOver = useCallback(() => {
    // 'new' means a clean slate, so the back stack goes with it — leaving history behind a fresh
    // question would let Back jump to an answer from a conversation the reader has ended.
    setPast([]);
    setHistory([]);
    setRestored(null);
    setAsked(null);
    setResolution(null);
    setQuestion('');
    reset();
  }, [reset]);

  const explainThisPage = useCallback(() => {
    // A route with no registered identity still deserves an answer, so fall back to the path itself
    // rather than silently doing nothing — an "Explain this page" tab that does nothing on some pages
    // is worse than one that gives a thinner answer.
    submit(
      pageExplanationQuestion(
        identity
          ? { title: identity.title, eyebrow: identity.eyebrow, description: identity.description }
          : { title: pathname },
      ),
    );
  }, [identity, pathname, submit]);

  // Switching INTO page mode asks immediately — the mode is the request, so making the reader press a
  // second button to get what the tab already promised would be a dead step. Switching back to the
  // tour clears the answer so they land on the questions rather than on a stale page explanation.
  const chooseMode = useCallback(
    (next: GuideMode) => {
      setMode(next);
      if (next === 'page') explainThisPage();
      else startOver();
    },
    [explainThisPage, startOver],
  );

  // In page mode, follow the reader as they navigate: arriving somewhere new IS a new question. Keyed
  // on pathname only — re-running whenever `explainThisPage` changed identity would fire twice for one
  // navigation, since the title updates in the same render as the path.
  useEffect(() => {
    if (!open || mode !== 'page') return;
    explainThisPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, mode, open]);

  // Re-measure whenever what is IN the body changes, not just on scroll — a new answer, a mode
  // switch or a role change all alter the height, and a fade left over from the previous content is
  // as misleading as no fade at all.
  useEffect(syncScrollFade, [syncScrollFade, history, mode, open, role, shownAsked, shownResult, width]);

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
          // `bg-card`, not `bg-background`. Measured: the page is rgb(247,248,248) and `bg-card` is
          // pure white, so a panel on `bg-background` renders the SAME grey as the page it floats over
          // and reads as flat and dingy — with only its header (which did use bg-card) showing white.
          // An overlay is an elevated surface; it should be the lighter one.
          className="fixed inset-y-0 right-0 z-40 hidden flex-col border-l border-border bg-card shadow-2xl animate-in slide-in-from-right fade-in-0 md:flex"
          style={{ width }}
        >
          {/* Resize handle on the left edge. 6px of grab area for a 1px visual line — a hairline is
              impossible to hit — and it only shows colour on hover so it stays invisible until wanted.
              Double-click resets to the default width. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the guide"
            onPointerDown={startResize}
            onPointerMove={onResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onDoubleClick={resetWidth}
            className="group absolute inset-y-0 -left-1 z-10 w-1.5 cursor-col-resize"
          >
            <div className="mx-auto h-full w-px bg-transparent transition-colors duration-150 group-hover:bg-primary" />
          </div>
          {/* Header */}
          {/* COLOUR DISCIPLINE. This surface previously carried emerald in four places at once — the
              icon, the title, every section heading and the button — which reads as a green box rather
              than a terminal surface with an accent. The brand rule is emerald ON black/white, one
              accent per surface. Structure is now carried by borders and `muted-foreground`; emerald is
              reserved for the icon and the single primary action. */}
          <header className="flex items-start gap-3 border-b border-border px-5 py-4">
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
              onClick={() => changeOpen(false)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </header>

          {/* Mode switch. Two questions a reader actually has: "what is this product" (the curated
              tour) and "what am I looking at right now". The second is the one they have after they
              have clicked into something, and it was previously unanswerable here. */}
          <div className="flex gap-1 border-b border-border px-5 py-2">
            {(
              [
                ['tour', 'Show me around'],
                ['page', 'Explain this page'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => chooseMode(value)}
                aria-pressed={mode === value}
                className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors duration-150 ${
                  mode === value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Body. The fade at the bottom is the scroll affordance: at a normal window height the
              list runs past the fold, and the cut landed right after a section heading — so the last
              group read as an empty section rather than as more content below. A soft mask over the
              final rows says "this continues" without adding a scrollbar to a narrow panel.
              `pb-6` keeps the last pill clear of the fade instead of dissolving into it. */}
          <div
            ref={bodyRef}
            onScroll={syncScrollFade}
            className="og-scroll-fade min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4"
          >
            {isViewer ? (
              <p className="mb-3 rounded border border-border bg-muted/50 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
                You are signed in to look around. Nothing you click here can change anything.
              </p>
            ) : null}

            {shownAsked ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-medium leading-snug text-foreground">{shownAsked}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* Only shown when there is somewhere to go back TO — a permanently-disabled
                        control is just clutter on a panel this narrow. */}
                    {past.length > 0 ? (
                      <button
                        type="button"
                        onClick={goBack}
                        className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ArrowLeft className="size-3" />
                        back
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={startOver}
                      className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
                    >
                      new
                    </button>
                  </div>
                </div>

                {shownResolution ? <Destinations resolution={shownResolution} onGo={goTo} /> : null}

                {shownLoading ? (
                  <div className="border-t border-border pt-3">
                    <CopilotAnswerSkeleton label="Reading the live records…" />
                  </div>
                ) : null}
                {error ? (
                  <p className="border-t border-border pt-3 text-xs text-destructive">{error}</p>
                ) : null}
                {shownResult ? (
                  <div className="og-fade-in border-t border-border pt-3">
                    <CopilotAnswerView result={shownResult} />
                  </div>
                ) : null}

                {/* WHAT TO ASK NEXT — derived from the answer just given, not the same eleven
                    starters. The reader has been told something; the useful next question follows
                    from that. Computed from the destinations the answer resolved to (see
                    followUpQuestions), so it is instant and every suggestion leads somewhere real —
                    a model-written follow-up costs another several seconds and can invent a question
                    this product cannot answer, dead-ending them on their second click.
                    On a 'none' match there is nothing to continue from, so it falls back to the full
                    list, which is exactly what that reader needs. */}
                {!shownLoading && shownResolution?.match === 'none' ? (
                  <Starters
                    questions={questions}
                    onPick={submit}
                    heading="Try one of these instead"
                    role={role}
                  />
                ) : null}
                {!shownLoading && shownResult && shownResolution?.match !== 'none' ? (
                  <FollowUps
                    questions={followUpQuestions(questions, shownResolution, history)}
                    onPick={submit}
                  />
                ) : null}
              </div>
            ) : (
              <>
                <RoleRow role={role} onChoose={chooseRole} />
                <Starters questions={questions} onPick={submit} heading={null} role={role} />
              </>
            )}
          </div>

          {/* COMPOSER. It was a bare textarea with two captions under it: no border, so the one place
              you can type did not look like a field, and the send action was a small mono button
              sitting beside the words "enter to ask". Now it is a real bordered input that takes the
              accent on focus, with the send control inside it.

              It also GROWS with the content up to a limit, because a two-row box silently scrolls a
              longer question out of sight while you are still writing it. */}
          <footer className="border-t border-border px-5 py-4">
            <div className="rounded-lg border border-border bg-background transition-colors duration-150 focus-within:border-primary">
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
                rows={1}
                // Grows to fit, capped — past the cap it scrolls, rather than eating the panel.
                style={{ height: 'auto', maxHeight: '9rem' }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
                }}
                // The placeholder names THIS screen, so the invitation is about where the reader
                // actually is rather than one fixed example they may not care about.
                placeholder={
                  identity
                    ? `Ask about ${identity.title} — or anything else`
                    : 'Ask anything — what stops a bad answer reaching a customer?'
                }
                className="max-h-36 w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] leading-snug text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <div className="flex items-center justify-between gap-2 px-3 pb-2">
                {/* "Enter to ask" was a LIE for a short question: submit returns early below
                    MIN_QUESTION_LENGTH, so typing "Hi" and pressing Enter did nothing at all and the
                    only signal was a faded button, which reads as styling rather than a rejection. */}
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {tooShort ? 'a few more characters' : 'enter to ask'}
                </span>
                <button
                  type="button"
                  onClick={() => submit(question)}
                  disabled={loading || question.trim().length < MIN_QUESTION_LENGTH}
                  aria-label="Ask"
                  className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
                >
                  {loading ? (
                    <span className="size-2 animate-pulse rounded-full bg-primary-foreground" />
                  ) : (
                    <ArrowUp className="size-4" weight="bold" />
                  )}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
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
            changeOpen(true);
            setTimeout(() => inputRef.current?.focus(), 60);
          }}
          aria-expanded={false}
          // Hidden below `md`: the console already shows a "use a bigger screen" gate there, and a
          // launcher floating over that gate would be the one thing on top of a deliberate dead end.
          className="fixed bottom-4 right-4 z-40 hidden items-center gap-2 rounded-full border border-primary bg-primary px-4 py-2.5 font-mono text-[11px] uppercase tracking-widest text-primary-foreground shadow-lg transition-opacity hover:opacity-90 md:flex"
        >
          <Compass className="size-4" />
          {/* NOT "Show me around" any more: that is now one of the two MODES inside the panel, so
              using it for the launcher too promised the tour and could open the page explainer. This
              names what the surface is for rather than one thing it does, and it matches the
              composer's own placeholder, so the invitation and the input agree. */}
          Ask anything
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
  role,
}: Readonly<{
  questions: ReturnType<typeof guideQuestionsForTenant>;
  onPick: (q: string) => void;
  heading: string | null;
  role: GuideRole | null;
}>) {
  return (
    <div className="space-y-3">
      {heading ? (
        <p className="border-t border-border pt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {heading}
        </p>
      ) : null}
      {/* Ordered for whoever is reading. themesForRole returns EVERY theme, reordered — a CISO who
          cannot find the cost story would be a tour that hides things, which is the opposite of the
          point. Without a role this is the default order, unchanged. */}
      {themesForRole(role).map((theme) => {
        const items = questions.filter((q) => q.theme === theme.id);
        if (items.length === 0) return null;
        return (
          <div key={theme.id} className="space-y-1">
            {/* Neutral, not emerald: three of these stack vertically, so an accent on each turned the
                list into a green ladder with nothing for the eye to land on. */}
            <p className="border-b border-border/60 pb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {theme.label}
            </p>
            {/* PILLS, not text rows. These were borderless lines that only revealed a border on
                hover, so a reader who never hovered had no way to tell the list was clickable at all —
                it read as body copy. Each is now a bordered pill that sizes to its own content, which
                also lets short ones share a row and makes the set look like a set of choices.
                Contrast matters as much as shape: the questions are the CONTENT of this panel, so they
                are `text-foreground`; rendering them muted made the whole surface look disabled.
                Emerald is reserved for hover, as the signal that a pill is selectable.
                Stagger via inline animation-delay is the cheap pattern globals.css sanctions, capped
                at 6 steps so a long list never feels like it is loading. */}
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {items.map((q, i) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => onPick(q.question)}
                  style={{ animationDelay: `${Math.min(i, 6) * 25}ms` }}
                  className="og-rise rounded-full border border-border bg-background px-3 py-1.5 text-left text-[12.5px] leading-snug text-foreground transition-colors duration-150 hover:border-primary hover:bg-primary/5 hover:text-primary"
                >
                  {q.question}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * "Tailor this to you" — a skippable row, never a gate.
 *
 * A role picker in FRONT of the panel would be a form before any value, and the readers these demo
 * links go to are exactly the ones who close the tab instead of filling one in. Someone who has seen
 * nothing yet also has no reason to answer. So it sits above the questions with the full list
 * underneath it either way: ignoring it costs nothing, and one tap re-orders the tour.
 */
function RoleRow({
  role,
  onChoose,
}: Readonly<{ role: GuideRole | null; onChoose: (r: GuideRole | null) => void }>) {
  const spec = guideRoleSpec(role);
  return (
    <div className="mb-3 space-y-1.5">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {spec ? 'Showing this for' : 'Tailor this to you'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {GUIDE_ROLES.map((r) => (
          <button
            key={r.id}
            type="button"
            // Tapping the active role clears it — the way out of a choice has to be the same control
            // that made it, or the reader is stuck with a guess they made in one click.
            onClick={() => onChoose(role === r.id ? null : r.id)}
            aria-pressed={role === r.id}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors duration-150 ${
              role === r.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      {spec ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{spec.opening}</p>
      ) : null}
    </div>
  );
}

/** Where to go next, computed from the answer just given. See followUpQuestions for why. */
function FollowUps({
  questions,
  onPick,
}: Readonly<{ questions: readonly GuideQuestion[]; onPick: (q: string) => void }>) {
  if (questions.length === 0) return null;
  return (
    <div className="space-y-1.5 border-t border-border pt-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Next, you might ask
      </p>
      <div className="flex flex-wrap gap-1.5">
        {questions.map((q, i) => (
          <button
            key={q.id}
            type="button"
            onClick={() => onPick(q.question)}
            style={{ animationDelay: `${Math.min(i, 6) * 25}ms` }}
            className="og-rise rounded-full border border-border bg-background px-3 py-1.5 text-left text-[12.5px] leading-snug text-foreground transition-colors duration-150 hover:border-primary hover:bg-primary/5 hover:text-primary"
          >
            {q.question}
          </button>
        ))}
      </div>
    </div>
  );
}
