'use client';

// The one presentational pagination control for the console. Purely presentational: it renders
// prev/next, a compact page-number range with ellipses, a page-size selector, and an "N–M of T"
// summary. It computes nothing about the data — it takes a PaginationResult (from ./paginate) and
// emits intents (onPageChange / onPageSizeChange). Wire it to the URL via `usePagination`.
//
// On-brand: mono type, emerald accent on the active page, brutalist/terminal borders, tokens only.

import { CaretLeft, CaretRight } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ELLIPSIS, PAGE_SIZE_OPTIONS, pageRange, type PaginationResult } from '@/lib/paginate';

export interface PaginationProps<T = unknown> {
  /** The computed page state (from `paginate` / `usePagination`). */
  state: Pick<
    PaginationResult<T>,
    'page' | 'pageCount' | 'total' | 'pageSize' | 'from' | 'to' | 'hasPrev' | 'hasNext'
  >;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  /** Page-size options to offer. Hide the selector by passing `pageSizeOptions={[]}`. */
  pageSizeOptions?: readonly number[];
  /** Singular noun for the "N–M of T <label>" summary. Default "items". */
  itemLabel?: string;
  /** Neighbours shown either side of the current page in the number range. */
  siblings?: number;
  className?: string;
}

export function Pagination<T = unknown>({
  state,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  itemLabel = 'items',
  siblings = 1,
  className,
}: Readonly<PaginationProps<T>>) {
  const { page, pageCount, total, pageSize, from, to, hasPrev, hasNext } = state;
  const range = pageRange(page, pageCount, siblings);
  const showSizeSelector = onPageSizeChange && pageSizeOptions.length > 0;

  // Nothing worth rendering: a single page and no size selector.
  if (pageCount <= 1 && !showSizeSelector) return null;

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'flex flex-col gap-3 border-t border-border pt-3 text-xs font-mono text-muted-foreground sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span aria-live="polite">
          {total === 0 ? (
            <>No {itemLabel}</>
          ) : (
            <>
              <span className="text-foreground tabular-nums">
                {from.toLocaleString()}–{to.toLocaleString()}
              </span>{' '}
              of <span className="text-foreground tabular-nums">{total.toLocaleString()}</span>{' '}
              {itemLabel}
            </>
          )}
        </span>
        {showSizeSelector ? (
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Rows per page</span>
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => onPageSizeChange?.(Number.parseInt(e.target.value, 10))}
              className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label="Previous page"
            disabled={!hasPrev}
            onClick={() => onPageChange(page - 1)}
          >
            <CaretLeft weight="bold" />
          </Button>

          {range.map((item, i) =>
            item === ELLIPSIS ? (
              <span
                key={`e-${i}`}
                aria-hidden
                className="px-1 text-muted-foreground select-none"
              >
                …
              </span>
            ) : (
              <Button
                key={item}
                type="button"
                size="icon-sm"
                variant={item === page ? 'default' : 'outline'}
                aria-label={`Page ${item}`}
                aria-current={item === page ? 'page' : undefined}
                onClick={() => onPageChange(item)}
                className="tabular-nums"
              >
                {item}
              </Button>
            ),
          )}

          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label="Next page"
            disabled={!hasNext}
            onClick={() => onPageChange(page + 1)}
          >
            <CaretRight weight="bold" />
          </Button>
        </div>
      ) : null}
    </nav>
  );
}
