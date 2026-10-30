'use client';

import { useEffect, useRef, useState } from 'react';
import { KitchenSheets } from './KitchenSheets';
import { KitchenNotice } from './KitchenNotice';
import { useKeepAwake } from '@/hooks/useKeepAwake';
import { t } from '@/lib/i18n';
// Type-only: the client bundle must never pull in kitchen-sheet (it reaches the database).
import type { KitchenData } from '@/lib/kitchen-sheet';

const POLL_MS = 30_000;
const clock = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jerusalem' });

interface StateReply {
  stamp: string;
  epoch: string;
  /** Only present when the saved copy differs from the stamp the screen sent. */
  data?: KitchenData;
}

/**
 * The kitchen screen: shows the sheets and keeps them current and the phone
 * awake. The sheets live in this component's state, fed by /api/kitchen/state,
 * so a failed check can only ever leave the last good sheets on screen — the
 * page itself is never re-requested except for a new deploy.
 *
 * Every 30 s, and at once when the page is shown again or the network returns,
 * it sends the stamp it holds. The server answers with a bare stamp when
 * nothing changed and with the new data when something did. The held stamp
 * moves only with data that arrived, so a lost reply is asked for again.
 */
export function KitchenScreen({ data: initial, stamp, epoch, renderedAt }: { data: KitchenData; stamp: string; epoch: string; renderedAt: string }) {
  const [data, setData] = useState(initial);
  // The server's render time, so the server render and hydration print the same minute.
  const [lastOk, setLastOk] = useState(() => new Date(renderedAt));
  const [offline, setOffline] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const stampRef = useRef(stamp);

  useKeepAwake();

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    async function check() {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/kitchen/state?have=${encodeURIComponent(stampRef.current)}`, { cache: 'no-store' });
        if (res.status === 401) {
          // Disconnected from the app: show the notice and stop asking.
          stop();
          setDisconnected(true);
          return;
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        const reply = (await res.json()) as StateReply;
        if (reply.epoch !== epoch) {
          // A new deploy: this page's code is out of date. We just got an answer, so we are online.
          console.warn('[kitchen] a new version is live; reloading');
          window.location.reload();
          return;
        }
        if (reply.data) {
          stampRef.current = reply.stamp;
          setData(reply.data);
        }
        setOffline(false);
        setLastOk(new Date());
      } catch (err) {
        console.warn('[kitchen] check failed:', err instanceof Error ? err.message : err);
        setOffline(true);
      } finally {
        inFlight = false;
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    function stop() {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
    }
    const timer = window.setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    return stop;
  }, [epoch]);

  if (disconnected) return <KitchenNotice title="kitchen.disconnected_title" />;
  const time = clock.format(lastOk);
  return (
    <>
      <KitchenSheets data={data} />
      <footer className={offline ? 'live live-off' : 'live'} role="status" aria-live="polite">
        {t(offline ? 'kitchen.offline' : 'kitchen.updated_at').replace('{time}', time)}
      </footer>
    </>
  );
}
