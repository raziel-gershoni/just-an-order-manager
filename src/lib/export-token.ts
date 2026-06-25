import { createHmac, timingSafeEqual } from 'node:crypto';

// Short-lived signed token authorizing a pricelist-file download for one group.
// Minted by an authenticated (manager) request, then carried in the download
// URL — so the file endpoint needs no initData (which Telegram's native
// downloadFile can't send and would mangle/expire in the URL anyway).

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
