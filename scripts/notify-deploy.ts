// Posts a Telegram message after a successful PRODUCTION build on Vercel.
// Wired into the build command after `next build`. This script must NEVER fail
// the build — every path swallows errors and exits 0.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

/** Recipient: an explicit DEPLOY_NOTIFY_CHAT_ID, else the bakery owner's
 *  Telegram id (creator of the public-site group). */
async function resolveChatId(): Promise<string | null> {
  if (process.env.DEPLOY_NOTIFY_CHAT_ID) return process.env.DEPLOY_NOTIFY_CHAT_ID;
  if (!process.env.DATABASE_URL) return null;
  try {
    const groupId = Number(process.env.PUBLIC_SITE_GROUP_ID) || 1;
    const sql = neon(process.env.DATABASE_URL);
    const rows = (await sql`
      SELECT u.telegram_id AS tid
      FROM groups g JOIN users u ON u.id = g.created_by
      WHERE g.id = ${groupId} LIMIT 1
    `) as { tid: string }[];
    return rows[0]?.tid ?? null;
  } catch (err) {
    console.log('[notify-deploy] owner lookup failed:', (err as Error)?.message);
    return null;
  }
}

async function main() {
  // Production Vercel builds only — skip local + preview builds.
  if (process.env.VERCEL_ENV !== 'production') {
    console.log('[notify-deploy] not a production build, skipping');
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[notify-deploy] TELEGRAM_BOT_TOKEN missing, skipping');
    return;
  }
  const chatId = await resolveChatId();
  if (!chatId) {
    console.log('[notify-deploy] no recipient (set DEPLOY_NOTIFY_CHAT_ID), skipping');
    return;
  }

  const sha = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);
  const ref = process.env.VERCEL_GIT_COMMIT_REF || '';
  const subject = (process.env.VERCEL_GIT_COMMIT_MESSAGE || '').split('\n')[0];
  const url =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '';

  const text = [
    '🚀 פריסה חדשה עלתה לאוויר',
    subject ? `📝 ${subject}` : null,
    sha ? `🔖 ${ref || 'main'} · ${sha}` : null,
    url ? `🔗 https://${url}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) {
    console.log('[notify-deploy] send failed:', res.status, await res.text().catch(() => ''));
  } else {
    console.log('[notify-deploy] sent');
  }
}

main().catch((err) => console.log('[notify-deploy] error:', (err as Error)?.message || err));
