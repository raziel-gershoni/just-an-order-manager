import { GrammyError, InlineKeyboard, type Api } from 'grammy';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { users, groupMembers } from '@/db/schema';
import { getBot } from '@/lib/bot';
import { t } from '@/lib/i18n';
import { siteBaseUrl } from '@/lib/site-url';
import { describeGeminiError, GeminiNotConfiguredError, type generateJson } from '@/lib/gemini';
import { failStaleDrafts, finishDraft } from '@/lib/order-drafts';
import { loadDraftContext, parseOrderMessage, type MessageInput } from '@/lib/order-from-message';
import { formatDraftMessage } from '@/lib/order-draft-format';

export interface DraftSender {
  userId: number;
  groupId: number;
  lang: 'he' | 'en';
}

/**
 * Who may send the bot an order: an owner, manager or baker. A person in
 * several bakeries gets the one with the lowest group id, so the choice is
 * stable between messages.
 */
export async function resolveDraftSender(telegramId: string): Promise<DraftSender | null> {
  const [user] = await db
    .select({ id: users.id, language: users.language })
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);
  if (!user) return null;
  const [member] = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, user.id), inArray(groupMembers.role, ['owner', 'manager', 'baker'])))
    .orderBy(asc(groupMembers.groupId))
    .limit(1);
  if (!member) return null;
  return { userId: user.id, groupId: member.groupId, lang: user.language };
}

export type DraftJobInput =
  | { kind: 'voice'; fileId: string; fileSize: number | null; mimeType: string | null; duration: number; caption: string | null }
  | { kind: 'text'; text: string };

export interface DraftJob {
  draftId: string;
  chatId: number;
  replyMessageId: number | null;
  groupId: number;
  input: DraftJobInput;
}

/** Gemini takes a 20 MB request inline; base64 adds a third, so audio stops at 14 MB. */
export const MAX_AUDIO_BYTES = 14 * 1024 * 1024;

interface ProcessDeps {
  api?: Api;
  generate?: typeof generateJson;
  fetchImpl?: typeof fetch;
}

type Keyboard = InlineKeyboard | undefined;

/**
 * Puts the answer in the sender's chat: edits the "מפענח…" message, or sends a
 * new one when there is none or the edit fails, so the answer is never lost.
 * Escaping is the caller's job; plain i18n strings contain no `<` or `&`.
 */
async function deliver(api: Api, job: DraftJob, html: string, keyboard?: Keyboard): Promise<void> {
  if (job.replyMessageId != null) {
    try {
      await api.editMessageText(job.chatId, job.replyMessageId, html, { parse_mode: 'HTML', reply_markup: keyboard });
      return;
    } catch (e) {
      console.error('[order-draft] edit failed, sending instead', {
        draftId: job.draftId,
        description: e instanceof GrammyError ? e.description : e instanceof Error ? e.name : 'unknown',
      });
    }
  }
  await api.sendMessage(job.chatId, html, { parse_mode: 'HTML', reply_markup: keyboard });
}

async function tooLong(api: Api, job: DraftJob, error: string): Promise<void> {
  await finishDraft(job.draftId, { status: 'failed', error });
  await deliver(api, job, t('bot.draft_too_long'));
}

/**
 * A run cut off at the platform's limit leaves its draft `pending` and the sender
 * looking at "מפענח…". The next message from that chat settles it: the old
 * message says the reading failed, so it can be sent again. Never throws.
 */
export async function reportStaleDrafts(chatId: number, deps: { api?: Api } = {}): Promise<void> {
  try {
    const stale = await failStaleDrafts(chatId);
    if (!stale.length) return;
    const api = deps.api ?? getBot().api;
    for (const d of stale) {
      console.error('[order-draft] stale draft marked failed', { draftId: d.id });
      if (d.replyMessageId == null) continue;
      try {
        await api.editMessageText(chatId, d.replyMessageId, t('bot.draft_failed'));
      } catch (e) {
        console.error('[order-draft] could not edit a stale draft', {
          draftId: d.id,
          description: e instanceof GrammyError ? e.description : e instanceof Error ? e.name : 'unknown',
        });
      }
    }
  } catch (e) {
    console.error('[order-draft] stale check failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Reads one message into a draft and tells the sender. Never throws: it runs after the reply to Telegram. */
export async function processOrderDraft(job: DraftJob, deps: ProcessDeps = {}): Promise<void> {
  const api = deps.api ?? getBot().api;
  const log = { draftId: job.draftId, source: job.input.kind };
  const started = Date.now();
  try {
    let input: MessageInput;
    if (job.input.kind === 'voice') {
      const v = job.input;
      console.info('[order-draft] voice', { ...log, seconds: v.duration, bytes: v.fileSize, mime: v.mimeType });
      if (v.fileSize != null && v.fileSize > MAX_AUDIO_BYTES) return await tooLong(api, job, 'too_big');
      let file;
      try {
        file = await api.getFile(v.fileId);
      } catch (e) {
        // Over Telegram's own 20 MB bot download limit.
        if (e instanceof GrammyError && /file is too big/i.test(e.description)) return await tooLong(api, job, 'too_big');
        throw e;
      }
      if (!file.file_path) throw new Error('telegram getFile returned no file_path');
      // The URL holds the bot token: it is never logged, and neither is an error that could carry it.
      const res = await (deps.fetchImpl ?? fetch)(
        `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`
      );
      if (!res.ok) throw new Error(`telegram file download HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_AUDIO_BYTES) return await tooLong(api, job, 'too_big');
      input = {
        kind: 'voice',
        audioBase64: bytes.toString('base64'),
        mimeType: (v.mimeType ?? 'audio/ogg').split(';')[0],
        caption: v.caption,
      };
    } else {
      console.info('[order-draft] text', { ...log, chars: job.input.text.length });
      input = { kind: 'text', text: job.input.text };
    }
    const ctx = await loadDraftContext(job.groupId);
    const result = await parseOrderMessage(input, ctx, { generate: deps.generate, logContext: log });
    await finishDraft(job.draftId, { status: result.status, transcript: result.transcript, draft: result.draft });
    if (result.status === 'empty') {
      await deliver(api, job, t('bot.draft_no_order'));
    } else {
      const url = `${siteBaseUrl()}/miniapp/orders/new?draft=${job.draftId}`;
      await deliver(
        api,
        job,
        formatDraftMessage(result.draft, result.transcript, ctx),
        new InlineKeyboard().webApp(t('bot.draft_open'), url)
      );
    }
    console.info('[order-draft] done', {
      ...log,
      status: result.status,
      lines: result.draft.lines.length,
      candidates: result.draft.customer.candidateIds.length,
      warnings: result.draft.warnings.map((w) => w.kind),
      ms: Date.now() - started,
    });
  } catch (e) {
    const notConfigured = e instanceof GeminiNotConfiguredError;
    console.error('[order-draft] failed', { ...log, ms: Date.now() - started, ...describeGeminiError(e) });
    try {
      await finishDraft(job.draftId, { status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 1000) });
    } catch (e2) {
      console.error('[order-draft] could not mark failed', { ...log, error: e2 instanceof Error ? e2.message : String(e2) });
    }
    try {
      await deliver(api, job, t(notConfigured ? 'bot.draft_not_configured' : 'bot.draft_failed'));
    } catch (e3) {
      console.error('[order-draft] could not tell the sender', { ...log, error: e3 instanceof Error ? e3.message : String(e3) });
    }
  }
}
