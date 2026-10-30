'use client';

import { useRef, useState } from 'react';

/**
 * The pairing button. It is an ordinary POST form, so it works before this
 * script loads; once it has, a second tap while the first is still travelling
 * is swallowed, so the one-time code can't be sent twice (the second send
 * would find it spent and bounce the phone to the expired page).
 */
export function PairForm({ code, label }: { code: string; label: string }) {
  const sent = useRef(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      method="post"
      action="/api/kitchen/pair"
      onSubmit={(e) => {
        if (sent.current) {
          e.preventDefault();
          return;
        }
        sent.current = true;
        setBusy(true);
      }}
    >
      <input type="hidden" name="code" value={code} />
      <button type="submit" className="pair-btn" disabled={busy}>
        {label}
      </button>
    </form>
  );
}
