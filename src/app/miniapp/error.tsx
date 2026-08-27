'use client';

import { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { t } from '@/lib/i18n';

/**
 * What the staff app shows when a screen throws while rendering.
 *
 * Until this existed, any render error blanked the whole mini app until it was
 * force-quit and reopened — and the verification gate cannot prevent that
 * class of bug, because apiFetch's generic is an assertion the caller writes
 * rather than a checked contract, so a route returning a narrower object than
 * the client claims typechecks and builds clean.
 *
 * Two ways out on purpose. `reset` re-renders this segment, which is enough
 * when the cause was a bad response that will not repeat; a full reload is the
 * escape hatch for when it is component state that keeps throwing.
 *
 * Reads `t` directly rather than through useT: the language context lives in
 * the layout, and an error screen should not depend on anything that might be
 * part of what broke.
 */
export default function MiniappError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[miniapp] screen failed to render', error);
  }, [error]);

  return (
    <div className="p-5">
      <Card className="flex flex-col items-center gap-3 bg-destructive/10 py-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <div>
          <p className="text-sm font-medium text-destructive">{t('error.title')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('error.body')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} className="min-h-11">
            {t('error.retry')}
          </Button>
          <Button variant="ghost" onClick={() => window.location.reload()} className="min-h-11">
            {t('error.reload')}
          </Button>
        </div>
        {/* The one thing worth relaying when reporting it — the console has the
            stack, but nobody reads a console on a phone. */}
        {error.digest && (
          <p dir="ltr" className="font-mono text-[10px] text-muted-foreground/60">
            {error.digest}
          </p>
        )}
      </Card>
    </div>
  );
}
