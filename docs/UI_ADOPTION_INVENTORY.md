# Console shared UI adoption inventory

**Inventory date:** 2026-07-17  
**Reviewed UI source:** `wednesday-solutions/component-library-animations@caa9e391241a98aed9b2f84302c60e54b85f3faf`
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
| Input / textarea  | 130 files import `components/ui/input`                                                             | Shared field primitives own label association, focus, disabled, validation and density       | **Adopted** through transparent Input, Textarea and Label compatibility exports.          |
| Select / combobox | 53 files contain native `<select>`; additional Radix/ad-hoc selectors exist                        | Shared Select/Combobox owns keyboard navigation, open state, validation and menu visuals     | NativeSelect is available through `ui/field`; searchable combobox migration remains.      |
| Dialog / sheet    | 20 files import `components/ui/dialog`; `form-sheet.tsx` composes the shared Sheet                 | Shared Dialog/Sheet owns focus trap, dismissal, overlay, reduced motion and responsive forms | **Adopted**; product FormSheet retains only safe form composition and sizing.              |
| Tabs              | Five files import `components/ui/tabs`; route-specific nav components also exist                   | Shared Tabs owns keyboard/ARIA and visuals; route tabs remain URL-driven product composition | **Adopted** for state-local tabs; route navigation remains Console-owned and URL-driven.  |
| Card / surface    | 169 files import `components/ui/card`; decorative card variants also exist                         | Shared Surface/Card owns border, radius, padding and theme behavior                          | **Adopted** through the existing Card import boundary.                                    |
| Navigation        | `Sidebar.tsx`, `SubNav.tsx` and several entity-specific nav components                             | Shared controls own disclosure, focus and collapsed visuals; Console owns IA and URL state   | Shared Disclosure is available; IA and URL state correctly remain Console-owned.         |
| Loaders           | `PageSkeleton.tsx`; three Skeleton and 32 Spinner import sites                                     | Shared Skeleton/Spinner/Progress owns reduced motion and sizing; routed content owns padding | **Adopted** through Skeleton, Spinner, LoadingBlock and Progress adapters.                 |
| Empty state       | Domain-specific empty copy/actions are scattered                                                   | Shared EmptyState owns layout; product supplies title, explanation and action                | Shared primitive and compatibility export are available for journey-by-journey adoption. |
| Error state       | Route errors and feature-local errors have inconsistent composition                               | Shared ErrorState owns presentation/retry; product owns recovery action and error policy     | Shared primitive and compatibility export are available for route/feature migration.     |

Every migration wave requires library tests, Console integration tests, reduced-motion and
accessibility checks, wide/narrow visual QA, typecheck, coverage and a production build.
Catalogue-only previews are ineligible until promoted into the reviewed `@offgrid/ui` exports.
