import { NextRequest, NextResponse } from 'next/server';
import { checkWhatsAppSignature, isValidVerifyToken } from '@/lib/whatsapp-signature';
import { parseMessagesValue, parseStatusesValue, parseErrorsValue, last4 } from '@/lib/whatsapp-inbound';
import { handleInboundMessage } from '@/lib/whatsapp-inbound-handler';

// A forwarded video is downloaded from Meta and uploaded to Telegram inside the
// request; 300 s is the Hobby ceiling, as for the Telegram bot route.
export const maxDuration = 300;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Meta's webhook handshake, sent when the callback is saved (here: the
 * per-number override of the bakery's number).
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const challenge = q.get('hub.challenge');
  if (q.get('hub.mode') === 'subscribe' && challenge !== null && isValidVerifyToken(q.get('hub.verify_token'))) {
    return new NextResponse(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  console.warn('[wa-webhook] verification refused (wrong mode or verify token, or WHATSAPP_VERIFY_TOKEN unset)');
  return new NextResponse('Forbidden', { status: 403 });
}

/**
 * Messages customers send to the bakery's WhatsApp number, and delivery
 * statuses of what the app sent. Worked inside the request, not in after(): a
 * failure becomes a 500, and Meta's own retries (for up to 7 days) are the
 * backoff. Already-forwarded messages are skipped by the whatsapp_inbound claim.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();

  const signature = checkWhatsAppSignature(raw, req.headers.get('x-hub-signature-256'));
  if (signature === 'unconfigured') {
    // 500, not 401: Meta keeps retrying until the env is fixed, so nothing sent meanwhile is lost.
    console.error('[wa-webhook] WHATSAPP_APP_SECRET is not set, cannot verify the signature');
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (signature === 'rejected') {
    console.warn('[wa-webhook] signature missing or wrong, request refused');
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    console.error('[wa-webhook] body is not JSON:', err);
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!phoneId) {
    console.error('[wa-webhook] WHATSAPP_PHONE_ID is not set, cannot tell whose messages these are');
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const entries = isObject(payload) && Array.isArray(payload.entry) ? payload.entry.filter(isObject) : [];
  let failed = false;

  for (const entry of entries) {
    const accountId = typeof entry.id === 'string' ? entry.id : null;
    const changes = Array.isArray(entry.changes) ? entry.changes.filter(isObject) : [];
    for (const change of changes) {
      if (change.field !== 'messages') {
        console.info('[wa-webhook] change skipped, field:', change.field, 'account:', accountId);
        continue;
      }
      const value = change.value;
      const metadata = isObject(value) && isObject(value.metadata) ? value.metadata : null;
      if (metadata?.phone_number_id !== phoneId) {
        console.info(
          '[wa-webhook] change for another number skipped, phone id ending',
          last4(typeof metadata?.phone_number_id === 'string' ? metadata.phone_number_id : null),
          'account:',
          accountId
        );
        continue;
      }

      for (const s of parseStatusesValue(value)) {
        const line = { account: accountId, messageId: s.messageId, status: s.status, to: last4(s.recipient) };
        if (s.status === 'failed') {
          console.error('[wa-webhook] status failed', line, s.error);
        } else {
          console.info('[wa-webhook] status', line);
        }
      }
      for (const e of parseErrorsValue(value)) {
        console.error('[wa-webhook] webhook error', { account: accountId, ...e });
      }
      for (const item of parseMessagesValue(value, accountId)) {
        try {
          await handleInboundMessage(item);
        } catch (err) {
          failed = true;
          console.error('[wa-webhook] handling failed, Meta will retry:', item.messageId, err);
        }
      }
    }
  }

  return failed ? NextResponse.json({ ok: false }, { status: 500 }) : NextResponse.json({ ok: true });
}
