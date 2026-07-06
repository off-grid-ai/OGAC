# Platform integration report — post-chat-epic sweep (2026-07-06)

QA / platform-integration verification after the chat-epic batch. Method: read source + cite
file:line, run the affected unit suites, grep for leaks. Adversarial — looking for UI actions with
no backing route, routes that 500 when a dependency is down, and mutations with no audit.

Verdict up front: **the platform coheres.** The four chat-epic features (inline citations, inline
thinking, @-mentions, inline artifact editing) are wired end-to-end and *compose* — a referenced KB
flows through the SAME citation numbering as project/org RAG. Gateway node control and sessions are
real wiring with honest degradation. No raw-IP leaks in rendered surfaces. Concerns below are
edge/robustness plus one bootstrap gap (federation role grant), not broken seams.

---

## Chat epic — inline citations · PASS

Full round trip verified:

- **Gather** — the stream route accumulates one `Citation[]` from every source: project RAG
  (`stream/route.ts:180-191`), org "Ask Your Org" knowledge (`:195-207`), @-mentioned KBs
  (`:214-232`), and executed connector tools (`:341-344`). Persisted on the assistant message
  (`:426`, `citations`) and sent on stream close (`:471`).
- **Number** — `citationInstruction(sourceNames(citations))` is injected AFTER all citations are
  gathered (`:237-240`), so the model's `[n]` markers line up with the footer numbering. Both prompt
  and render derive numbering from the same `buildSources()` (`chat-citations.ts:33`, `:116`) — they
  cannot drift.
- **Render** — `parseCitationMarkers` splits the answer into text/cite segments
  (`chat-citations.ts:67`); `Markdown.tsx:62-105` linkifies `[n]` into `<CiteChip>` only when
  `sourceCount>0 && onCiteClick` is wired, degrading to plain text otherwise (`:70`).
- **Footer + jump** — `SourcesFooter` (`ChatWorkspace.tsx:193`) renders the deduped numbered sources
  with best-score + matched parts; clicking a chip calls `jumpToSource` (`:262-267`) which
  `scrollIntoView`s the registered `<li>` and applies a 1.6s highlight. Refs registered at `:333-336`.

Clean degradation confirmed: no sources → `buildSources` returns `[]` → footer returns null
(`:199`), markers render inert. Dangling `[5]` when only 3 sources → `valid:false` → inert
(`chat-citations.ts:84`).

## Chat epic — inline thinking · PASS

- Stream relays `reasoning_content` deltas as `{ reasoning }` (`stream/route.ts:401-404`) separate
  from `{ content }` (`:405-408`); persisted as `reasoning` on the message (`:425`).
- `ThinkingBlock` (`ChatWorkspace.tsx:152`) drives presentation purely from `thinkingState`
  (`chat-thinking.ts:29`): streaming+no-answer → expanded live; answer-started/done → collapsed by
  default. Rendered ABOVE the answer body (`:308`), never mixed in. 12 unit tests pass.

## Chat epic — @-mentions · PASS (composes with citations)

- **Detect/rank/fold** are pure (`chat-mentions.ts` `activeMention`/`matchMentions`/`buildRefsPayload`),
  wired in the composer (`ChatWorkspace.tsx:520-522`, payload built `:1090`, sent `:1113`).
- **Threaded into the stream** — `parseRefsPayload` at the route boundary (`stream/route.ts:81`);
  referenced memory ids resolve to facts scoped to the caller (`memoryFactsByIds(userId, …)`,
  `:139`) and inject a `referenced_memory` block.
- **Access-gated** — @-mentioned KB scopes retrieve ONLY after `projectAccess(userId, projectId,
  role)` passes (`:222`); others are silently skipped. De-dupes the already-retrieved project
  (`:215-219`).
- **Same citations** — @-KB hits are `citations.concat(r.citations)` (`:226`), the identical
  `Citation` shape, and the numbering instruction runs after this branch (`:237`). So a referenced KB
  DOES produce clickable chips + footer entries. Composition verified.

## Chat epic — inline artifact editing · PASS

- Edit buffer + baseline in `ArtifactView` (`ArtifactView.tsx:58-66`); dirty/savable from pure
  `isArtifactDirty`/`canSaveArtifact` (`artifacts.ts:108`, `:114`).
- Save posts `artifactSavePayload` (original title threaded so the new version lands on the same
  logical row) to the EXISTING `POST /api/v1/chat/artifacts` (`ArtifactView.tsx:80`), which versions
  server-side by (user, conversation, title). New baseline advances on success (`:90`).
- `ArtifactEditor` is pure presentation, Cmd/Ctrl+S → save, Esc → cancel (`ArtifactEditor.tsx:22-30`).
  8 `artifact-edit` unit tests pass.

**CONCERN (minor):** the `ArtifactView` instance rendered at `ChatWorkspace.tsx:1865` (the
transcript-chip open path) passes `title` + `conversationId` but NOT `onSaved`, while the
library-context instance at `:1870` wires `onSaved={refreshProjects}`. Saving from the chip path
works (persists a version) but the projects/library list won't refresh until the next navigation.
Low severity — logged as a gap.

## Gateway node control · PASS

`GatewayControl.tsx` → `POST /api/v1/gateway/nodes/[name]` → aggregator `POST /nodes/:name`. The
route is admin-gated (`requireAdmin`, `[name]/route.ts:44`), validates the action set (`:49`),
resolves the live node via `GET /nodes` (`:28-41`), and validates with pure `validateNodeAction`
(`:56`). **Honest degradation is explicit:** a blocked action → 501 `{notActionable}` (`:59-60`),
aggregator 404/501 → 501 `{notActionable}` (`:73-77`), unreachable aggregator → 502 (`:80-81`) —
never a fake 200. `fetchNode` swallows errors → null → 404 (`:38`), so a down aggregator yields a
clean 404, not a 500. Graceful.

**CONCERN (audit):** node control mutations (model swap / restart / enable / disable) do NOT write an
audit event, unlike the chat budget-deny path (`stream/route.ts:300`). A privileged, state-changing
fleet action with no accountability trail. Logged as a gap.

## Federation · CONCERN (403 handled at the message level, NOT auto-granted)

The previous "bare 403 Forbidden leaks up" bug IS fixed — but by making the error *actionable*, not
by auto-granting the role:

- `keycloak-admin.ts:88-93` carries the empty-body 403 as a status; `forbiddenGrantMessage()`
  (`keycloak-realm.ts:33-40`) turns it into an operation-specific message naming exactly which
  `realm-management` role to grant to which client. The Access page surfaces the same guidance
  (`access/page.tsx:59-62`).
- **There is NO server-side `assignRoles()` call that grants `realm-management` to the console's own
  service account.** The grant remains a MANUAL step in the Keycloak admin console. So federation
  writes (create IdP, etc.) still 403 on a fresh realm until an operator grants the role by hand —
  the console now *tells you how*, but doesn't self-heal. Logged as a gap (severity: medium — a
  one-time bootstrap, well-signposted, but not "handled server-side").

Routes: `admin/access/idp/route.ts` (GET/POST), `idp/[alias]/route.ts` (DELETE); UI
`components/access/IdpList.tsx`.

## Sessions · PASS

- **Online + offline merge** — `mergeUserSessions()` (`keycloak-realm.ts:97-106`) merges both lists,
  deduped by id (online wins for a shared id — it's the live one), sorted by `lastAccess` desc.
  Called directly by the route (`admin/access/users/[id]/sessions/route.ts:39`).
- **mDNS IP enrichment** — `normalizeSession()` (`keycloak-realm.ts:78`) runs each session's IP
  through `toDisplayHost()`, mapping loopback/LAN/fleet IPs to `offgrid-*.local` — no raw IP reaches
  the view.

## Raw IP / host leaks · PASS

Grep of `src/components` + `src/app` `*.tsx` for `127.0.0.1` / `192.168.` found three hits, ALL
masked through `toDisplayHost` before render:

- `VectorDBInspector.tsx:12,55` — default + hint both wrapped.
- `gateway/page.tsx:35` `GATEWAY_URL` is a server-side fetch target; every UI render goes through
  `toDisplayHost` (`:61,74,82,86`).
- `data/page.tsx:211` passes the raw env value as `urlHint`, but `VectorDBInspector` wraps it on
  ingest (`:55`).

No raw loopback/LAN IP reaches the rendered DOM.

---

## Coherence verdict

**PASS — coheres.** The chat epic is genuinely integrated (not four bolted-on features): a single
`Citation[]` pipeline feeds citations, @-mentions fold into it access-gated, thinking is a clean
separate channel, and artifact editing reuses the existing versioned save route. Gateway control is
honest about what the backend actually supports; sessions merge correctly with masked IPs. Three
real concerns are logged as gaps: (1) artifact-chip save doesn't refresh the library, (2)
node-control mutations aren't audited, (3) federation's realm-management grant is a manual bootstrap,
not automatic. None is a broken seam. All 47 chat-epic unit tests pass.

**Not verified live in this sweep** (read-and-verify only, no deploy): actual streaming against the
aggregator, real Keycloak 403→grant recovery on the live realm, and the artifact save round trip in
the browser. These need the live stack.
