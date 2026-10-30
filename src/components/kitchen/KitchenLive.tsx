'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const POLL_MS = 30_000;
const clock = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jerusalem' });

/**
 * Keeps the kitchen screen current and awake. Every 30 s, and at once when the
 * page is shown again or the network returns, it asks the server whether the
 * saved sheet changed; only then does it re-render the page. The stamp it
 * compares against comes from the page's own props, never set here, so a
 * refresh that fails (Wi-Fi drop) is tried again at the next check instead of
 * being taken as done.
 */
export function KitchenLive({ stamp, labels }: { stamp: string; labels: { updated: string; offline: string } }) {
  const router = useRouter();
  const stampRef = useRef(stamp);
  const [lastOk, setLastOk] = useState(() => new Date());
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    stampRef.current = stamp;
  }, [stamp]);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    async function check() {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch('/api/kitchen/state', { cache: 'no-store' });
        if (res.status === 401) {
          // Disconnected from the app: the page re-renders as the disconnected
          // notice, which has no poller, so the checks stop here.
          router.refresh();
          return;
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        const { stamp: next } = (await res.json()) as { stamp: string };
        setOffline(false);
        setLastOk(new Date());
        if (next !== stampRef.current) router.refresh();
      } catch (err) {
        console.warn('[kitchen] check failed:', err instanceof Error ? err.message : err);
        setOffline(true);
      } finally {
        inFlight = false;
      }
    }
    const timer = window.setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
    };
  }, [router]);

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    async function acquire() {
      if (!('wakeLock' in navigator)) {
        console.warn('[kitchen] this browser cannot keep the screen on');
        return;
      }
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch (err) {
        console.warn('[kitchen] keeping the screen on was refused:', err instanceof Error ? err.message : err);
      }
    }
    // The lock is dropped whenever the page is hidden; take it again on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch((err) => console.warn('[kitchen] releasing the screen lock failed:', err));
    };
  }, []);

  const time = clock.format(lastOk);
  return (
    <footer className={offline ? 'live live-off' : 'live'} role="status" aria-live="polite">
      {(offline ? labels.offline : labels.updated).replace('{time}', time)}
    </footer>
  );
}
