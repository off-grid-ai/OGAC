// Pure, zero-IO pagination logic. No imports, no React, no DOM — unit-testable in isolation.
// This is the single source of truth for "given items + page + pageSize, what do I show and what
// controls do I render?" Both the presentational <Pagination> control and the useUrlPagination hook
// build on these functions so page math lives in exactly one place.

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface PaginationResult<T> {
  /** The items on the current (clamped) page. */
  pageItems: T[];
  /** The clamped, 1-based current page. Always in [1, pageCount]. */
  page: number;
  /** Total number of pages (>= 1 even when there are no items). */
  pageCount: number;
  /** Total number of items across all pages. */
  total: number;
  /** Effective page size actually used (clamped to >= 1). */
  pageSize: number;
  /** 1-based index of the first item on this page (0 when there are no items). */
  from: number;
  /** 1-based index of the last item on this page (0 when there are no items). */
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/** Clamp a requested page into the valid [1, pageCount] range. Non-finite / <1 → 1. */
export function clampPage(page: number, pageCount: number): number {
  const max = Math.max(1, Math.floor(pageCount) || 1);
  if (!Number.isFinite(page)) return 1;
  const p = Math.floor(page);
  if (p < 1) return 1;
  if (p > max) return max;
  return p;
}

/** Coerce an untrusted page-size into a sane positive integer. */
export function clampPageSize(pageSize: number, fallback = DEFAULT_PAGE_SIZE): number {
  if (!Number.isFinite(pageSize)) return fallback;
  const s = Math.floor(pageSize);
  return s < 1 ? fallback : s;
}

/**
 * The core: slice `items` for the given 1-based `page` and `pageSize`, clamping the page so an
 * out-of-range page (stale URL, deleted rows) still renders the nearest valid page rather than a
 * blank screen. Pure — returns a fresh result, never mutates the input.
 */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): PaginationResult<T> {
  const size = clampPageSize(pageSize);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = clampPage(page, pageCount);
  const start = (current - 1) * size;
  const end = Math.min(start + size, total);
  const pageItems = items.slice(start, end);
  return {
    pageItems,
    page: current,
    pageCount,
    total,
    pageSize: size,
    from: total === 0 ? 0 : start + 1,
    to: end,
    hasPrev: current > 1,
    hasNext: current < pageCount,
  };
}

/**
 * A single ellipsis marker in a page-range. Rendered as a non-interactive gap.
 */
export const ELLIPSIS = 'ellipsis' as const;
export type PageRangeItem = number | typeof ELLIPSIS;

/**
 * Compute the compact page-number range for the control, e.g. `[1, ellipsis, 4, 5, 6, ellipsis, 20]`.
 * Always shows the first and last page, the current page, and `siblings` neighbours on each side,
 * collapsing the rest into ellipses. Never emits an ellipsis in place of a single hidden page (it
 * just shows that page). Pure.
 */
export function pageRange(page: number, pageCount: number, siblings = 1): PageRangeItem[] {
  const total = Math.max(1, Math.floor(pageCount) || 1);
  const current = clampPage(page, total);
  const sib = Math.max(0, Math.floor(siblings));

  // Small enough to show every page with no ellipsis. `boundaries(2)` + `sib*2` + `current(1)` +
  // `two ellipses(2)` → if the page count doesn't exceed that budget, list them all.
  const totalToShow = sib * 2 + 5; // first, last, current, 2*siblings, 2 ellipsis slots
  if (total <= totalToShow) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const leftSibling = Math.max(current - sib, 1);
  const rightSibling = Math.min(current + sib, total);

  // Whether to show ellipsis on each side. We only show one when >1 page is being collapsed;
  // otherwise we surface the single hidden page directly (avoids "1 … 3" where 2 is hidden).
  const showLeftEllipsis = leftSibling > 2;
  const showRightEllipsis = rightSibling < total - 1;

  const first = 1;
  const last = total;

  if (!showLeftEllipsis && showRightEllipsis) {
    const leftCount = 3 + 2 * sib;
    const left = Array.from({ length: leftCount }, (_, i) => i + 1);
    return [...left, ELLIPSIS, last];
  }

  if (showLeftEllipsis && !showRightEllipsis) {
    const rightCount = 3 + 2 * sib;
    const right = Array.from({ length: rightCount }, (_, i) => total - rightCount + 1 + i);
    return [first, ELLIPSIS, ...right];
  }

  // Both ellipses: first … [siblings around current] … last
  const middle = Array.from({ length: rightSibling - leftSibling + 1 }, (_, i) => leftSibling + i);
  return [first, ELLIPSIS, ...middle, ELLIPSIS, last];
}
