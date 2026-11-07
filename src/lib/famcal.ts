import pRetry, { AbortError } from 'p-retry';
import { z } from 'zod/v4';

/**
 * The one client of famcal's Jewish times API v1 (https://famcal.bot, the
 * owner's own app; reference: famcal's docs/api/jewish-times-v1.md). The
 * kitchen screen's Shabbat mode takes its times here and nowhere else.
 * Server only: it reads FAMCAL_API_KEY.
 *
 * - The place is a famcal city slug, always with the community and lang=he;
 *   famcal answers 400 to any other parameter, so nothing else is sent.
 * - Network failures, 429 and 5xx are retried with backoff (p-retry); any
 *   other answer, a body that is not JSON, or one in a shape we don't know
 *   fails at once. famcal's v1 may add fields: unknown ones are dropped.
 * - Every failed attempt is logged with famcal's error code; the key never is.
 */

export const FAMCAL_API = 'https://famcal.bot/api/v1';
export const COMMUNITIES = ['sephardi', 'ashkenazi', 'chabad'] as const;
export type Community = (typeof COMMUNITIES)[number];
export function isCommunity(value: unknown): value is Community {
  return typeof value === 'string' && (COMMUNITIES as readonly string[]).includes(value);
}

/** `code` is famcal's error code (UNKNOWN_CITY, INVALID_KEY, RATE_LIMITED, …), or NO_KEY / BAD_ANSWER / HTTP_<status> of ours. */
export class FamcalError extends Error {
  constructor(readonly code: string, readonly status: number | null, message: string) {
    super(message);
    this.name = 'FamcalError';
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.object({ at: z.string().nullable(), local: z.string().nullable() });
const holiday = z.object({ title: z.string(), brief: z.string(), kind: z.string(), chag: z.boolean() });
const row = z.object({ key: z.string(), opinion: z.string().nullable(), name: z.string(), at: z.string().nullable(), local: z.string().nullable() });
const credit = z.object({ source: z.string(), text: z.string(), url: z.string().optional() });

const shabbatAnswer = z.object({
  blocks: z.array(
    z.object({
      eve: day,
      last: day,
      candleLighting: time,
      start: time,
      end: z.object({ key: z.string(), name: z.string(), at: z.string().nullable(), local: z.string().nullable() }).nullable(),
      parasha: z.object({ title: z.string(), brief: z.string() }).nullable(),
      holidays: z.array(holiday),
    })
  ),
  credits: z.array(credit),
});
const dayAnswer = z.object({
  date: day,
  hebrewDate: z.object({ gematriya: z.string(), day: z.number(), month: z.string() }),
  holidays: z.array(holiday),
  rows: z.array(row),
  credits: z.array(credit),
});
export type ShabbatAnswer = z.infer<typeof shabbatAnswer>;
export type DayAnswer = z.infer<typeof dayAnswer>;
export type FamcalHoliday = z.infer<typeof holiday>;

/** famcal's error code from an error body ({ error: { code, message } }), or HTTP_<status>. */
async function errorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } };
    if (typeof body?.error?.code === 'string') return body.error.code;
  } catch (err) {
    console.warn(`[famcal] a ${res.status} answer had no JSON error body:`, err instanceof Error ? err.message : err);
  }
  return `HTTP_${res.status}`;
}

async function famcalGet<T>(path: 'shabbat' | 'day', params: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
  const key = process.env.FAMCAL_API_KEY;
  if (!key) {
    console.error('[famcal] FAMCAL_API_KEY is not set');
    throw new FamcalError('NO_KEY', null, 'FAMCAL_API_KEY is not set');
  }
  const url = `${FAMCAL_API}/${path}?${new URLSearchParams({ ...params, lang: 'he' })}`;
  return pRetry(
    async () => {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
      if (!res.ok) {
        const code = await errorCode(res);
        const err = new FamcalError(code, res.status, `famcal /${path} answered ${res.status} ${code}`);
        if (res.status === 429 || res.status >= 500) throw err; // retried; logged by onFailedAttempt
        console.error(`[famcal] /${path} refused: ${res.status} ${code}`);
        throw new AbortError(err);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch (cause) {
        console.error(`[famcal] /${path} answered with a body that is not JSON:`, cause);
        throw new AbortError(new FamcalError('BAD_ANSWER', res.status, `famcal /${path} answered with a body that is not JSON`));
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        console.error(`[famcal] /${path} answered in a shape we don't know:`, parsed.error.message);
        throw new AbortError(new FamcalError('BAD_ANSWER', res.status, `famcal /${path} answered in an unknown shape`));
      }
      return parsed.data;
    },
    {
      retries: 3,
      factor: 2,
      minTimeout: 1000,
      randomize: true,
      onFailedAttempt: ({ error, attemptNumber, retriesLeft }) =>
        console.warn(`[famcal] /${path} attempt ${attemptNumber} failed (${retriesLeft} retries left): ${error.message}`),
    }
  );
}

/** Every Shabbat and Yom Tov stretch whose eve is from `from` to `to` (yyyy-MM-dd at the place), plus one under way on `from`. */
export function fetchShabbat(city: string, community: Community, from: string, to: string): Promise<ShabbatAnswer> {
  return famcalGet('shabbat', { city, community, from, to }, shabbatAnswer);
}

/** One day's zmanim, holidays and Hebrew date at the place. */
export function fetchDay(city: string, community: Community, date: string): Promise<DayAnswer> {
  return famcalGet('day', { city, community, date }, dayAnswer);
}
