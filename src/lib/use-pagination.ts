'use client';

// URL-driven pagination hook. Per the console's nav-in-URL rule, the current page and page-size are
// a navigational position and therefore live in the URL searchParams — NOT local component state —
// so a paginated view is deep-linkable, shareable, and Back-button coherent. Two lists on the same
// page namespace their params via `key` (e.g. ?auditPage=3&runsPage=1).
//
// The pure page math lives in ./paginate; this hook is the thin I/O adapter that reads params and
// pushes new ones. It returns a ready-to-render slice plus setters that update the URL.

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import {
  DEFAULT_PAGE_SIZE,
  clampPageSize,
  paginate,
  type PaginationResult,
} from './paginate';

export interface UsePaginationOptions {
  /**
   * Namespace for the URL params, so multiple paginated lists coexist on one route. `key="audit"`
   * → `?auditPage` / `?auditSize`. Defaults to the bare `page` / `size`.
   */
  key?: string;
  /** Initial / fallback page size when the URL doesn't specify one. */
  defaultPageSize?: number;
  /**
   * When true, the URL is updated with `router.push` (adds a history entry per page change).
   * Default false → `router.replace` (page changes don't spam the Back stack; leaving the page still
   * Backs out cleanly). Most tables want replace; use push only when each page is a distinct "place".
   */
  pushHistory?: boolean;
}

export interface UsePaginationReturn<T> extends PaginationResult<T> {
  pageParam: string;
  sizeParam: string;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  goToPage: (page: number) => void; // alias of setPage, reads better at call sites
  nextPage: () => void;
  prevPage: () => void;
}

function paramNames(key?: string): { pageParam: string; sizeParam: string } {
  if (!key) return { pageParam: 'page', sizeParam: 'size' };
  return { pageParam: `${key}Page`, sizeParam: `${key}Size` };
}

/**
 * Drive pagination of an already-fetched `items` array from the URL. Client-side slicing over the
 * in-memory list (we prefer this over re-fetching for console tables that already hold the full
 * result set — see TASK #123 constraint).
 */
export function usePagination<T>(
  items: readonly T[],
  options: UsePaginationOptions = {},
): UsePaginationReturn<T> {
  const { key, defaultPageSize = DEFAULT_PAGE_SIZE, pushHistory = false } = options;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { pageParam, sizeParam } = paramNames(key);

  const rawPage = Number.parseInt(searchParams.get(pageParam) ?? '', 10);
  const rawSize = Number.parseInt(searchParams.get(sizeParam) ?? '', 10);
  const page = Number.isFinite(rawPage) ? rawPage : 1;
  const pageSize = clampPageSize(Number.isFinite(rawSize) ? rawSize : defaultPageSize, defaultPageSize);

  const result = useMemo(() => paginate(items, page, pageSize), [items, page, pageSize]);

  const commit = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const p = new URLSearchParams(searchParams.toString());
      mutate(p);
      const qs = p.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (pushHistory) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [searchParams, pathname, router, pushHistory],
  );

  const setPage = useCallback(
    (next: number) => {
      commit((p) => {
        if (next <= 1) p.delete(pageParam);
        else p.set(pageParam, String(Math.floor(next)));
      });
    },
    [commit, pageParam],
  );

  const setPageSize = useCallback(
    (next: number) => {
      const size = clampPageSize(next, defaultPageSize);
      commit((p) => {
        // Reset to page 1 when the page size changes — the old page index is meaningless.
        p.delete(pageParam);
        if (size === defaultPageSize) p.delete(sizeParam);
        else p.set(sizeParam, String(size));
      });
    },
    [commit, pageParam, sizeParam, defaultPageSize],
  );

  const nextPage = useCallback(() => setPage(result.page + 1), [setPage, result.page]);
  const prevPage = useCallback(() => setPage(result.page - 1), [setPage, result.page]);

  return {
    ...result,
    pageParam,
    sizeParam,
    setPage,
    goToPage: setPage,
    setPageSize,
    nextPage,
    prevPage,
  };
}
