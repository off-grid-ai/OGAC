export type ConsoleContentMode = 'page' | 'workspace';

// Full-bleed workspaces own their internal panes, scrolling, and spacing. Everything else uses the
// standard management-page gutter. Keep this route policy pure so shell behavior cannot drift into
// page-level negative-margin workarounds.
const WORKSPACE_ROOTS = ['/work/chat', '/workspace/chat'] as const;

export function consoleContentMode(pathname: string): ConsoleContentMode {
  return WORKSPACE_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`))
    ? 'workspace'
    : 'page';
}
