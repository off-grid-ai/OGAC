# List → Detail audit

Standing rule (CLAUDE.md, "List → detail everywhere"): wherever the console shows a collection of
entities, an item should open a real, deep-linkable DETAIL view (`/x/[id]`) — not a flat row you
can't drill into, and not a cramped modal for something that's actually a "place." A modal/side
panel is fine for a quick create/edit form, but not as the only way to see an entity that has DEPTH
(sub-resources, status over time, or its own actions).

This audit records every entity-collection surface: its entity, whether it already has a detail
route, whether the entity has DEPTH, and the action taken. Reference pattern: `/apps/[id]` lifecycle
shell + the project detail page (`/projects/[id]`).

## Already have a detail route (reference / prior work)

| Surface | Entity | Detail route | Notes |
| --- | --- | --- | --- |
| `/apps` | app | `/apps/[id]` (+ input/runs/review/reports) | reference lifecycle shell |
| `/projects` | project | `/projects/[id]` | reference master→detail |
| `/agents` | agent | `/agents/[id]` (+ `/runs/[runId]`) | done |
| `/fleet` | device | `/fleet/[id]` | facts, assigned policy, activity audit, software inventory — done |
| `/chat` | conversation | `/chat/[conversationId]` | done |
| `/observability/evals` | eval def | `/observability/evals/[id]` | done |
| `/brain/docs`, `/brain/prompts` | doc / prompt | `/brain/docs/[id]`, `/brain/prompts/[id]` | done |
| `/artifacts` | artifact | `/artifacts/[id]` | done |
| `/studio` | template | `/studio/new/[id]` | done |

## Audited this pass

| Surface | Entity | Had detail route? | DEPTH? | Action |
| --- | --- | --- | --- | --- |
| `/data` (Connectors) | connector | no (row + actions menu) | **YES** — config, live-query dialect, sync/ingest history, bound data-domains | **ADDED** `/data/connectors/[id]` |
| `/knowledge` | collection | no (docs in a modal) | **YES** — documents sub-resource (upload/index/delete), access roles | **ADDED** `/knowledge/[id]` |
| `/data-domains` | data domain | no (card + edit side-panel) | moderate — binding, bound connector, test-resolve | **ADDED** `/data-domains/[id]` (cross-links connector, scoped resolve tester) |
| `/access` (Users) | user (Keycloak) | no (inline expandable rows) | **YES** — roles, sessions, MFA, password | **ADDED** `/access/[id]` (task #137) |
| `/reports` | report template | no (card grid) | moderate — sections, frameworks, run/export | fine as card — `ReportsManager` already exposes run/export/edit/delete + URL-driven preview; not a flat row |
| `/(governance)/secrets` | secret / lease | manager panels | **YES** — versions, leases, dynamic-db | fine — already a nested management surface (`SecretsManagerNav`, versions/leases/seal panels) |
| `/(build)/tools` | tool | no (table, edit/delete inline) | low — flat fields | quick-edit modal ok (no sub-resources / history) |
| `/backups` | backup | no | low — aggregated status view + restore/prune actions | fine as row (no per-backup sub-resources) |
| `/services` | service | no (static directory) | none — static + live health probe | fine as row (read-only directory) |
| `/(data)/integrations` | binding / connector | no (cards) | low — inline status/actions | fine as row |
| `/(governance)/guardrails` | rule / recognizer | no | moderate | **owned by #129/guardrails agent** — not touched |
| `/(governance)/policy` | rule / module | no | moderate | **owned by #129/policy agent** — not touched |
| `/(governance)/regulatory` | control / governance item | no | moderate | **owned by regulatory agent** — not touched |
| `/(insights)/siem` | event / suppression | no | low–moderate | quick-edit modal ok; events are a log stream, not "places" |
| `/(governance)/control` | policy history / routing rule / RBAC user | no (flat tables) | low each | inline controls ok for now |

## Detail views built this pass

1. **Connector detail — `/data/connectors/[id]`**
   - Config (type, auth, endpoint, description), derived live-query **dialect** (via `detectDialect`,
     no connection opened), status.
   - **Bound data domains** — every rule that routes to this connector (cross-links to
     `/data-domains`).
   - **Sync history** — ingest runs for this connector, most recent first.
   - Actions: reuses `ConnectorActions` (sync now / remove).
   - Getter: `src/lib/connector-detail.ts` (`getConnectorDetail` / `getConnector` /
     `listSyncHistory`) — thin, additive; store.ts unchanged.

2. **Knowledge collection detail — `/knowledge/[id]`**
   - Metadata + **access roles** (allow-list) + created-by.
   - **Documents** sub-resource — list with kind/size/date; admin upload/index + per-doc delete
     (reuses the existing `collections/[id]/documents` POST + `documents/[docId]` DELETE).
   - Role-gated the same as the list: a non-admin only reaches a collection their role may retrieve.
   - Component: `src/components/knowledge/CollectionDocuments.tsx`; reuses `getCollection` /
     `listDocuments`.

3. **Data-domain detail — `/data-domains/[id]`**
   - Full binding (label + aliases → connector · resource); **cross-links to the bound connector**
     detail.
   - Edit (URL-driven side panel, reuses `DomainFormPanel`) + delete (confirm → back to list).
   - **Scoped test-resolve** — runs the pure `resolveDomainRanked` across all domains and shows
     whether THIS domain wins the phrase (or which sibling steals it), with the ranked scores.
   - Component: `src/components/data-domains/DomainDetailPanel.tsx`; reuses `getDomain` /
     `listDomains`.

## Deferred → resolved

- **Users — `/access/[id]` (task #137, DONE).** The inline expandable rows are gone; each user row
  now links to a deep-linkable detail page. The page reuses the same Keycloak env gate as `/access`
  (renders a "not configured" card without the admin env) and every call degrades gracefully on a
  403/unreachable Keycloak (honest banner, never a 500), mirroring the Sessions/Federation panels.
  - Route: `src/app/(console)/(governance)/access/[id]/page.tsx` (server gate) →
    `UserDetailPanel` (`src/components/access/UserDetailPanel.tsx`, client).
  - Shows: profile facts (username/email/verified/status), **realm roles** (add/remove via the
    existing `users/[id]/roles` POST/DELETE), **reset password**, **MFA** (require/cancel OTP,
    remove credential, via `users/[id]/mfa`), and **active sessions** scoped to the user (revoke one
    / log out everywhere, via `users/[id]/sessions` — IPs mDNS'd through the existing
    `mergeUserSessions`).
  - Pure logic: `src/lib/user-detail.ts` (`diffRoles`, `userDisplayName`, `userSubtitle`) with
    `test/user-detail.test.ts`.
- **Guardrails / Policy / Regulatory** — owned by concurrent agents this round; not touched to avoid
  merge conflicts. Each has `[id]` API routes and moderate depth (rule definition + hit history) and
  is a good next candidate once those agents land.
