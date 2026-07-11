'use client';

import * as React from 'react';

import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

// The canonical create/edit side-panel.
//
// WHY THIS EXISTS: the `Sheet` primitive is intentionally low-level — callers hand-structure
// SheetContent's children. Several create/edit panels put their form fields in a RAW <div>
// instead of <SheetBody>, which is where the horizontal padding (px-6) lives. The result: fields
// CLIP at the panel's left edge. `FormSheet` bakes the correct structure in
// (Header › Body › Footer, body always padded + scrollable) so a caller CANNOT mis-structure it.
//
// Use `FormSheet` for every create/edit panel. Reach for the raw `Sheet` primitive only for
// genuinely custom layouts (e.g. a two-pane settings view) — see the note in
// `test/form-sheet.test.ts` for the rule.

export type FormSheetSize = 'sm' | 'md' | 'lg';

// Pure size→width mapping, extracted so it can be unit-tested without a DOM. The Sheet primitive
// already defaults `right`/`left` to `sm:max-w-md`; we override with an explicit width per size.
const SIZE_CLASS: Record<FormSheetSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
};

export function formSheetSizeClass(size: FormSheetSize = 'md'): string {
  return SIZE_CLASS[size] ?? SIZE_CLASS.md;
}

export interface FormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Fields go here — always rendered inside a padded, scrollable SheetBody so they can't clip. */
  children: React.ReactNode;
  /** Sticky footer content (e.g. the submit button). Rendered inside SheetFooter. */
  footer?: React.ReactNode;
  side?: 'left' | 'right';
  size?: FormSheetSize;
  /** Extra classes for the SheetContent shell (rarely needed). */
  className?: string;
  showCloseButton?: boolean;
}

export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = 'right',
  size = 'md',
  className,
  showCloseButton = true,
}: Readonly<FormSheetProps>) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        showCloseButton={showCloseButton}
        className={cn(formSheetSizeClass(size), className)}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        {/* SheetBody carries px-6 + overflow-y-auto: raw field children can never clip or overflow. */}
        <SheetBody>{children}</SheetBody>
        {footer ? <SheetFooter>{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}
