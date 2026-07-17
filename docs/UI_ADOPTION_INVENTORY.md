# Console shared UI adoption inventory

**Inventory date:** 2026-07-17  
**Reviewed UI source:** `wednesday-solutions/component-library-animations@4e6cc4e4c45438891c3397fee4b55e66bde4f6e6`  
**Reviewed design source:** `off-grid-ai/shared@698789d4aea406e0d782259de1667c3684ac4e20`

This is the bounded Console adoption backlog, not a claim that the UI is already fully consistent.
`@offgrid/design` owns tokens and `@offgrid/ui` owns reusable visual and interaction primitives.
Console owns domain data, routes, actions and composition. A local adapter may translate a product
API, but must not recreate the primitive's visuals or behavior.

Counts are search-based migration indicators identifying files importing the named primitive and
native-control hotspots where no shared primitive exists.

| Seam              | Console evidence                                                                                   | Required shared end-state                                                                    | Status / next migration                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Button            | 201 files import `components/ui/button`; 93 files still contain native `<button>`                  | Shared Button owns focus, disabled/loading, variants, motion and touch behavior              | **Adopted** through a thin legacy-size adapter. Audit intentional native buttons next.    |
| Input / textarea  | 130 files import `components/ui/input`                                                             | Shared field primitives own label association, focus, disabled, validation and density       | Curate accessible Input/Textarea in `@offgrid/ui`, then replace the local implementation. |
| Select / combobox | 53 files contain native `<select>`; additional Radix/ad-hoc selectors exist                        | Shared Select/Combobox owns keyboard navigation, open state, validation and menu visuals     | Inventory native versus searchable use cases; curate both primitives before migration.    |
| Dialog / sheet    | 20 files import `components/ui/dialog`; `sheet.tsx` and `form-sheet.tsx` are separate local owners | Shared Dialog/Sheet owns focus trap, dismissal, overlay, reduced motion and responsive forms | Consolidate modal semantics in the library; retain only product form composition locally. |
| Tabs              | Five files import `components/ui/tabs`; route-specific nav components also exist                   | Shared Tabs owns keyboard/ARIA and visuals; route tabs remain URL-driven product composition | Curate Tabs and migrate non-route tabs without moving navigation state local.             |
| Card / surface    | 169 files import `components/ui/card`; decorative card variants also exist                         | Shared Surface/Card owns border, radius, padding and theme behavior                          | Curate a dense operator Card; remove decorative duplicates from management surfaces.      |
| Navigation        | `Sidebar.tsx`, `SubNav.tsx` and several entity-specific nav components                             | Shared controls own disclosure, focus and collapsed visuals; Console owns IA and URL state   | Migrate primitives after IA routes are frozen; never move route state into the library.   |
| Loaders           | `PageSkeleton.tsx`; three Skeleton and 32 Spinner import sites                                     | Shared Skeleton/Spinner/Progress owns reduced motion and sizing; routed content owns padding | Curate the loader family and remove per-feature animation implementations.                |
| Empty state       | Domain-specific empty copy/actions are scattered; no canonical primitive                           | Shared EmptyState owns layout; product supplies title, explanation and action                | Add a quiet, full-width-aware operator EmptyState, then migrate by user journey.          |
| Error state       | Route errors and feature-local errors have no single visual primitive                              | Shared ErrorState owns presentation/retry; product owns recovery action and error policy     | Add the primitive plus route/feature adapters; verify destructive and offline cases.      |

Every migration wave requires library tests, Console integration tests, reduced-motion and
accessibility checks, wide/narrow visual QA, typecheck, coverage and a production build.
Catalogue-only previews are ineligible until promoted into the reviewed `@offgrid/ui` exports.
