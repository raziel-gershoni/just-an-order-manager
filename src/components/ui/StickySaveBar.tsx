import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A page's primary save, pinned above the bottom nav and lifted clear of the
 * on-screen keyboard (see .sticky-save-bar in globals.css; the nav hides while
 * the keyboard is open). Goes inside a `p-5` container: -mx-5 bleeds to the
 * screen edges. `flush` is for a full-screen overlay that covers the nav, where
 * the bar belongs at the very bottom instead of above it.
 */
export function StickySaveBar({
  className,
  flush,
  children,
}: {
  className?: string;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-sticky-save
      className={cn(
        'sticky-save-bar sticky z-30 -mx-5 border-t border-border bg-card/95 px-5 py-3 backdrop-blur-md',
        flush && 'sticky-save-bar--flush',
        className
      )}
    >
      {children}
    </div>
  );
}
