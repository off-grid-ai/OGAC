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

// ─── Press + hover feel for EVERY button in the console ───────────────────────────────────────────
//
// Measured 2026-08-05: the built shared primitive (`@offgrid/ui/operator/button`) carries no
// `transition`, no `hover:` and no `active:` state at all, so every button in the product changed
// colour instantly and did nothing at all on press. Across `src/components` only 97 of 441 files used
// a transition of any kind — the console was ~78% static, which is what "it feels difficult" is
// actually describing.
//
// WHY HERE AND NOT IN THE SHARED PACKAGE: `@offgrid/ui` is consumed as a PREBUILT artifact in
// node_modules with no linked source in the monorepo, so it cannot be edited from this repo. This
// wrapper already exists to inject legacy size classes, which makes it the one place every console
// Button passes through.
//
// Transform is listed explicitly rather than using `transition-all`, so a button never animates
// layout properties (width/height) when its label changes — that reads as a wobble, not a response.
// No `motion-reduce:` guard is needed: globals.css strips transitions app-wide under
// `prefers-reduced-motion: reduce`.
const BUTTON_MOTION =
  'transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-150 ease-out active:scale-[0.98]';

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
    BUTTON_MOTION,
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
      className={cn(legacyButtonSizeClass(size), BUTTON_MOTION, className)}
      size={sharedButtonSize(size)}
      variant={variant}
    />
  );
}

export { Button, buttonVariants };
