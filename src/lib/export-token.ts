import { createHmac, timingSafeEqual } from 'node:crypto';

// Short-lived signed token authorizing a manager-scope read of one group,
// carried in a URL. Minted by an authenticated (manager) request, so the target
// needs no initData — which the callers can't supply: Telegram's native
// downloadFile can't send headers (pricelist file, income report), and the
// printable packing sheet is opened in an external browser that was never given
// initData.
//
// A `purpose` binds a token to one consumer. Without one, a print link — half an
// hour long, sitting in an outside browser's history — would also open every
// customer's balance. Tokens minted without a purpose sign exactly what they
// always did, so the print and pricelist links are unchanged; they just can't be
// spent anywhere that asks for a purpose. The unpurposed payload is digits and
// dots only, so it can never collide with a `purpose:` one.

function secret(): string {
  const s = process.env.TELEGRAM_BOT_TOKEN;
  if (!s) throw new Error('TELEGRAM_BOT_TOKEN not set');
  return s;
}

function mac(payload: string, purpose?: string): string {
  return createHmac('sha256', secret())
    .update(purpose ? `${purpose}:${payload}` : payload)
    .digest('hex');
}

export function signExportToken(groupId: number, ttlSeconds = 300, purpose?: string): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${groupId}.${exp}`;
  return `${payload}.${mac(payload, purpose)}`;
}

/** Returns the groupId if the token is valid, unexpired and minted for `purpose`, else null. */
export function verifyExportToken(token: string, purpose?: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [gidStr, expStr, sig] = parts;
  const expected = mac(`${gidStr}.${expStr}`, purpose);
  let ok = false;
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    ok = a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return null;
  }
  if (!ok) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const gid = Number(gidStr);
  return Number.isInteger(gid) && gid > 0 ? gid : null;
}
