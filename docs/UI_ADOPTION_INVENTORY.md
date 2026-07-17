# Shared UI adoption inventory

**Inventory date:** 2026-07-17  
**Console revision:** `92e6d825110d1d70943796ee1a3165d4d799d262`  
**Desktop revision inspected:** `79a88c325e619805fc2543a0c45d9d3c2569a19f`  
**Reviewed UI source:** `wednesday-solutions/component-library-animations@4e6cc4e4c45438891c3397fee4b55e66bde4f6e6`  
**Reviewed design source:** `off-grid-ai/shared@698789d4aea406e0d782259de1667c3684ac4e20`

This is the bounded adoption backlog, not a claim that the product suite is already visually
consistent. `@offgrid/design` owns tokens and `@offgrid/ui` owns reusable visual and interaction
primitives. Console and Desktop may own domain data, routes, actions and composition. A local
adapter may translate a product API, but must not recreate the primitive's visuals or behavior.

Counts below are search-based migration indicators, not component-quality scores. They identify
files importing the named Console primitive, plus native-control hotspots where no primitive exists.

| Seam              | Console evidence                                                                                   | Desktop evidence                                                                    | Required shared end-state                                                                                      | Status / next migration                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Button            | 201 files import `components/ui/button`; 93 files still contain native `<button>`                  | `components/ui/button.tsx`; 29 files contain native `<button>`                      | Shared Button owns focus, disabled/loading, variants, motion and touch behavior                                | **Console adopted** through a thin legacy-size adapter. Audit native buttons and migrate Desktop next. |
| Input / textarea  | 130 files import `components/ui/input`                                                             | Nine files contain native `<input>`                                                 | Shared field primitives own label association, focus, disabled, validation and density                         | Curate accessible Input/Textarea in `@offgrid/ui`, then replace both product implementations.          |
| Select / combobox | 53 Console files contain native `<select>`; additional Radix/ad-hoc selectors exist                | Four files contain native `<select>`                                                | Shared Select/Combobox owns keyboard navigation, open state, validation and menu visuals                       | Inventory native versus searchable use cases; curate both primitives before migration.                 |
| Dialog / sheet    | 20 files import `components/ui/dialog`; `sheet.tsx` and `form-sheet.tsx` are separate local owners | `components/ui/dialog.tsx` used by Command Palette; animated modal is another owner | Shared Dialog/Sheet owns focus trap, dismissal, overlay, reduced motion and responsive form treatment          | Consolidate modal semantics in the library, then retain only product form composition locally.         |
| Tabs              | Five files import `components/ui/tabs`; additional route-specific nav components exist             | `SourceFilterTabs.tsx` is product-local                                             | Shared Tabs owns keyboard/ARIA and visual states; route tabs remain URL-driven product composition             | Curate Tabs, migrate non-route tabs, then adapt route tabs without moving navigation state local.      |
| Card / surface    | 169 files import `components/ui/card`; decorative card variants also exist                         | `SettingsCard.tsx` plus ad-hoc surfaces                                             | Shared Surface/Card owns border, radius, padding and theme behavior                                            | Curate dense operator Card; remove duplicate decorative variants from management surfaces.             |
| Navigation        | `Sidebar.tsx`, `SubNav.tsx` and several entity-specific nav components                             | `components/ui/sidebar.tsx`, `App.tsx`, `navRegistry.ts`                            | Shared navigation controls own disclosure, focus and collapsed visuals; each product owns its IA and URL state | Migrate primitives only after current IA routes are frozen; do not share product route registries.     |
| Loaders           | `PageSkeleton.tsx`; three Skeleton and 32 Spinner import sites                                     | Loading behavior is repeated across at least ten application files                  | Shared Skeleton/Spinner/Progress owns reduced motion and sizing; routed content owns padding                   | Curate loader family and remove per-feature animation implementations.                                 |
| Empty state       | Domain-specific empty copy/actions are scattered; no canonical primitive                           | Empty states are repeated across chat, projects, models, skills and settings        | Shared EmptyState owns layout; product supplies title, explanation and action                                  | Add a quiet, full-width-aware operator EmptyState, then migrate by user journey.                       |
| Error state       | Route errors and feature-local errors have no single visual primitive                              | No canonical renderer error-state primitive found                                   | Shared ErrorState owns presentation and retry affordance; product owns recovery action and error policy        | Add primitive plus route/feature adapters; verify destructive and offline cases.                       |

## Migration order

1. Inputs, textarea, Select/Combobox and field validation—the largest interactive inconsistency
   after Button.
2. Dialog/Sheet and Tabs—centralize keyboard, focus and navigation semantics before styling work.
3. Card/Surface and navigation controls—remove duplicate visual ownership without sharing product IA.
4. Loader, EmptyState and ErrorState—complete loading/empty/error journeys across both products.

Every wave requires library tests, product integration tests, reduced-motion/accessibility checks,
wide and narrow visual QA, typecheck, coverage and production builds. Catalogue-only preview
components are not eligible for product use until promoted into the reviewed `@offgrid/ui` export
boundary.
