// Pure mobile-drawer state machine — zero imports, no I/O, no React. Unit-tested in isolation
// (see mobile-nav.test.ts). The console shell shows the sidebar nav in a slide-in drawer on phones
// (below the `md` breakpoint); this module owns the ONE invariant that keeps that drawer coherent:
// it is closed on the desktop-sized shell and MUST close whenever the route changes (so tapping a
// nav row navigates AND dismisses the overlay, never leaving it stuck open over the new page).
//
// Keeping this as a pure reducer (rather than inline useState in the Topbar) means the close-on-nav
// rule is unit-testable without mounting React, and the .tsx wrapper stays a thin consumer that
// dispatches intents and renders the boolean.

export type DrawerAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'toggle' }
  // Fired when the route (pathname) changes. Always resolves to closed — navigating away from the
  // current page must dismiss the drawer, whether it was open (tapped a nav row) or already closed.
  | { type: 'navigate' };

// The drawer is a single boolean: open or not. Reduce an action against the current state.
export function drawerReducer(open: boolean, action: DrawerAction): boolean {
  switch (action.type) {
    case 'open':
      return true;
    case 'close':
      return false;
    case 'toggle':
      return !open;
    case 'navigate':
      // Route changed — always close, regardless of prior state.
      return false;
    default:
      // Unrecognized intent (only reachable at runtime past the type system) — stay put, never
      // crash or flip state on a bad action.
      return open;
  }
}
