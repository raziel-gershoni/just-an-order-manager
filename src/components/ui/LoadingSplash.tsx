'use client';

import { Wheat, Loader2 } from 'lucide-react';

/**
 * App-shell loading screen shown while auth + the active group resolve. DOCKET-
 * flavored (kraft docket card, mono ticket eyebrow, wheat seal) but unambiguous
 * about what's happening — a spinner and "טוען…" so the wait reads as a wait.
 */
export function LoadingSplash() {
  return (
    <div
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-background px-8 text-foreground"
    >
      <div className="flex w-full max-w-[280px] flex-col items-center gap-5 rounded-[8px] border border-border bg-card px-6 pb-6 pt-7 shadow-sm">
        <div className="flex w-full items-center justify-between">
          <span className="font-mono text-[10px] font-semibold tracking-widest text-primary">№ ····</span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            DOCKET
          </span>
        </div>

        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Wheat className="h-8 w-8 text-primary animate-pulse" />
        </div>

        <div className="w-full space-y-2" aria-hidden>
          <div className="h-2 w-3/5 animate-pulse rounded-full bg-muted" />
          <div className="h-2 w-full animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
        </div>

        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm font-medium">טוען…</span>
        </div>
      </div>
    </div>
  );
}
