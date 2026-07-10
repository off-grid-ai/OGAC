'use client';

import { type CSSProperties, memo, type ReactNode } from 'react';

// An animated aurora gradient clipped to text. Restrained to ONE accent word in the hero.
// Emerald-tuned to the Off Grid palette; falls back to a static fill under reduced motion.
interface AuroraTextProps {
  children: ReactNode;
  className?: string;
  colors?: string[];
  speed?: number;
}

export const AuroraText = memo(function AuroraText({
  children,
  className = '',
  colors = ['#34D399', '#059669', '#6EE7B7', '#34D399'],
  speed = 1,
}: AuroraTextProps) {
  const style: CSSProperties = {
    backgroundImage: `linear-gradient(135deg, ${colors.join(', ')}, ${colors[0]})`,
    backgroundSize: '200% auto',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    animationDuration: `${8 / speed}s`,
  };

  return (
    <span className={`relative inline-block ${className}`}>
      <span className="sr-only">{children}</span>
      <span className="og-aurora relative bg-clip-text" style={style} aria-hidden="true">
        {children}
      </span>
    </span>
  );
});
