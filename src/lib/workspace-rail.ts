// Pure child-normalization helpers for the workspace CardRail (Knowledge / Projects / Prompts list
// layout). Zero React runtime import (type-only) and no I/O, so the rail's list-flattening + key
// derivation are unit-testable in isolation and the component stays a thin presenter.
// See test/workspace-rail.test.ts.

// A minimal structural view of what we read off a React element — we only need `key`.
type Keyed = { key?: unknown };

/**
 * Normalize arbitrary React children to a flat array of renderable nodes: flatten nested arrays and
 * drop the values React itself renders as nothing (`null`, `undefined`, `false`). A single node
 * becomes a one-item array; a nullish/`false` child becomes an empty array. Pure.
 */
export function normalizeChildren(children: unknown): unknown[] {
  if (Array.isArray(children)) {
    return (children.flat(Infinity) as unknown[]).filter((c) => c != null && c !== false);
  }
  return children == null || children === false ? [] : [children];
}

/**
 * Stable rail-item key: reuse a child element's own `key` when present, else fall back to its index.
 * Mirrors how React keys a list so re-orders don't remount the wrong card. Pure.
 */
export function railKey(child: unknown, index: number): string | number {
  if (
    child != null &&
    typeof child === 'object' &&
    'key' in child &&
    (child as Keyed).key != null
  ) {
    const k = (child as Keyed).key;
    if (typeof k === 'string' || typeof k === 'number') return k;
  }
  return index;
}
