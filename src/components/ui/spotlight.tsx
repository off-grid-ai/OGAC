'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

// A restrained premium spotlight backdrop: two soft emerald sweeps that fade in once.
// Emerald-tuned Aceternity SpotlightNew; purely decorative, aria-hidden, motion-safe.
interface SpotlightProps {
  className?: string;
}

export function Spotlight({ className }: SpotlightProps) {
  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.4, ease: 'easeOut' }}
      className={cn('pointer-events-none absolute inset-0 z-0 overflow-hidden', className)}
    >
      <div className="absolute left-0 top-0 h-[140%] w-[60%] -translate-y-1/2 bg-[radial-gradient(closest-side,rgba(52,211,153,0.16),transparent)] blur-2xl" />
      <div className="absolute bottom-0 right-0 h-[140%] w-[55%] translate-y-1/3 bg-[radial-gradient(closest-side,rgba(5,150,105,0.12),transparent)] blur-2xl" />
    </motion.div>
  );
}
