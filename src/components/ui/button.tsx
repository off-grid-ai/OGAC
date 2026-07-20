import {
  Button as SharedButton,
  buttonVariants as sharedButtonVariants,
  type ButtonProps as SharedButtonProps,
} from '@offgrid/ui/operator/button';

import {
  legacyButtonSizeClass,
  sharedButtonSize,
  type LegacyButtonSize,
} from '@/lib/button-compatibility';
import { cn } from '@/lib/utils';

type ButtonVariant = NonNullable<SharedButtonProps['variant']>;

type ButtonVariantOptions = {
  className?: string;
  size?: LegacyButtonSize;
  variant?: ButtonVariant;
};

function buttonVariants({
  className,
  size = 'default',
  variant = 'default',
}: ButtonVariantOptions = {}) {
  return cn(
    sharedButtonVariants({ size: sharedButtonSize(size), variant }),
    legacyButtonSizeClass(size),
    className,
  );
}

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: Omit<SharedButtonProps, 'size'> & { size?: LegacyButtonSize }) {
  return (
    <SharedButton
      {...props}
      className={cn(legacyButtonSizeClass(size), className)}
      size={sharedButtonSize(size)}
      variant={variant}
    />
  );
}

export { Button, buttonVariants };
