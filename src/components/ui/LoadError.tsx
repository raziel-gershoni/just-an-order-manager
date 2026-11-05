'use client';

import { useState } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { Button } from './Button';
import { useT } from '@/hooks/useLang';

/**
 * What a screen, sheet or list shows instead of its content when the data did
 * not load, so a failed load never passes for an empty one (and nothing can be
 * saved over data that was never read). `compact` is one line, for a picker or
 * a section inside a screen that otherwise loaded.
 *
 * When `onRetry` returns the load's promise, the button spins until it settles;
 * the caller clears its failed flag only when the load succeeds, so this stays
 * up (rather than flashing an empty list) while the retry runs.
 */
export function LoadError({ onRetry, loading = false, compact = false }: { onRetry: () => void | Promise<unknown>; loading?: boolean; compact?: boolean }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const retry = (
    <Button
      variant="outline"
      size="sm"
      className="min-h-[44px]"
      loading={loading || pending}
      onClick={() => {
        const p = onRetry();
        if (p) {
          setPending(true);
          // The load is meant to log and flag its own failure; this only stops the spinner.
          p.then(
            () => setPending(false),
            (err) => {
              console.error('[load-error] retry rejected:', err);
              setPending(false);
            }
          );
        }
      }}
    >
      <RotateCw className="h-4 w-4" />
      {t('error.retry')}
    </Button>
  );
  if (compact) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 py-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          {t('load.failed')}
        </span>
        {retry}
      </div>
    );
  }
  return (
    <div role="alert">
      <EmptyState icon={AlertTriangle} title={t('load.failed')} description={t('load.failed_hint')} action={retry} />
    </div>
  );
}
