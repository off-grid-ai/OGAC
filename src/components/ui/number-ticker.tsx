'use client';

import { NumberTicker as LibraryNumberTicker } from '@offgrid/ui/operator/magic/number-ticker';
import { cn } from '@/lib/utils';
import { isAnimatableNumber, parseFormattedNumber } from '@/lib/motion/count-up';

// The library's Magic UI number ticker, the same one the website renders. The console's stats
// also arrive pre-formatted ("1,200", "98.6%", "$4.2M", "n/a"), so this keeps the one parse
// (src/lib/motion/count-up.ts): the numeric magnitude counts up in the library ticker, the
// surrounding text renders verbatim, and a non-numeric string renders as-is.
interface NumberTickerProps {
  value: number | string;
  decimalPlaces?: number;
  className?: string;
  suffix?: string;
  prefix?: string;
}

export function NumberTicker({
  value,
  decimalPlaces = 0,
  className,
  suffix = '',
  prefix = '',
}: Readonly<NumberTickerProps>) {
  const fmt =
    typeof value === 'number'
      ? { prefix, suffix, value, decimals: decimalPlaces, grouped: false }
      : parseFormattedNumber(value);

  return (
    <span className={cn('inline-block tabular-nums tracking-tight', className)}>
      {fmt.prefix}
      {isAnimatableNumber(fmt) ? (
        <LibraryNumberTicker value={fmt.value} decimalPlaces={fmt.decimals} />
      ) : null}
      {fmt.suffix}
    </span>
  );
}
