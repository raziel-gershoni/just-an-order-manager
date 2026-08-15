import { createHmac, timingSafeEqual } from 'node:crypto';

// Short-lived signed token authorizing a manager-scope read of one group,
// carried in a URL. Minted by an authenticated (manager) request, so the target
// needs no initData — which the two callers can't supply: Telegram's native
// downloadFile can't send headers (pricelist file), and the printable packing
// sheet is opened in an external browser that was never given initData.

function secret(): string {
  const s = process.env.TELEGRAM_BOT_TOKEN;
  if (!s) throw new Error('TELEGRAM_BOT_TOKEN not set');
  return s;
}

export function signExportToken(groupId: number, ttlSeconds = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${groupId}.${exp}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

/** Returns the groupId if the token is valid + unexpired, else null. */
export function verifyExportToken(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [gidStr, expStr, sig] = parts;
  const expected = createHmac('sha256', secret()).update(`${gidStr}.${expStr}`).digest('hex');
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
