import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// The cn() helper shadcn / Aceternity / Magic UI components expect at @/lib/utils.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
