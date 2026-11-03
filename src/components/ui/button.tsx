import SmoothButton, {
  smoothButtonVariants,
  type SmoothButtonProps,
} from '@offgrid/ui/operator/smooth-button';
import { forwardRef } from 'react';

// The library's SmoothUI button, intact, joined to the alive layer — the same button the website
// ships (website/preview-ui/button.jsx). The alive layer reads two attributes, data-slot="button"
// and data-variant, and gives every button its hover lift, press give, pointer light and click
// ring. data-size mirrors the size so CSS can size touch targets per size.
//
// SmoothButton already has every size the console uses; `icon-xs` was a console-only size and
// maps to the library's smallest icon size.

type ButtonSize = NonNullable<SmoothButtonProps['size']> | 'icon-xs';
type ButtonProps = Omit<SmoothButtonProps, 'size'> & { size?: ButtonSize };

function librarySize(size: ButtonSize): NonNullable<SmoothButtonProps['size']> {
  return size === 'icon-xs' ? 'icon-sm' : size;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'default', ...props },
  ref,
) {
  return (
    <SmoothButton
      ref={ref}
      data-slot="button"
      data-variant={variant ?? 'default'}
      data-size={size}
      variant={variant}
      size={librarySize(size)}
      {...props}
    />
  );
});

function buttonVariants({
  className,
  size = 'default',
  variant = 'default',
}: { className?: string; size?: ButtonSize; variant?: SmoothButtonProps['variant'] } = {}) {
  return smoothButtonVariants({ className, size: librarySize(size), variant });
}

export { Button, buttonVariants };
export type { ButtonProps };
