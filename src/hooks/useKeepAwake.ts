'use client';

import { useEffect } from 'react';

/**
 * Keeps the screen on with the Wake Lock API while the component is mounted.
 * The browser drops the lock whenever the page is hidden, so it is asked for
 * again each time the page becomes visible. Used by the kitchen screen and by
 * its error view, so a failed load never lets the phone go dark.
 */
export function useKeepAwake(): void {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let unmounted = false;
    const release = (sentinel: WakeLockSentinel) =>
      sentinel.release().catch((err) => console.warn('[kitchen] releasing the screen lock failed:', err));

    async function acquire() {
      if (!('wakeLock' in navigator)) {
        console.warn('[kitchen] this browser cannot keep the screen on');
        return;
      }
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        // Unmounted while the request was pending: nothing will release it later.
        if (unmounted) void release(sentinel);
        else lock = sentinel;
      } catch (err) {
        console.warn('[kitchen] keeping the screen on was refused:', err instanceof Error ? err.message : err);
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unmounted = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (lock) void release(lock);
    };
  }, []);
}
