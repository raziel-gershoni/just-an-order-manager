import { GoogleGenAI } from '@google/genai';

/** The model and thinking level are fixed by the owner's choice, not settings. */
export const GEMINI_MODEL = 'gemini-3.8-flash';
export const GEMINI_THINKING = 'medium';

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super('GEMINI_API_KEY is not set');
  }
}

export type GeminiPart =
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'text'; text: string };

export interface GeminiJsonRequest {
  system: string;
  parts: GeminiPart[];
  schema: Record<string, unknown>;
  /** Ids only (draft id, user id, source): this is spread into every log line. */
  logContext: Record<string, unknown>;
}

export interface GeminiJsonResult {
  text: string;
  usage: { input: number | null; output: number | null; thought: number | null };
  ms: number;
}

/**
 * The app's only call to Google. The SDK retries 408/409/429/5xx and dropped
 * connections itself (4 times, with backoff, honouring Retry-After), so there
 * is no second loop here; the fetch wrapper only makes each attempt visible in
 * the logs. `store: false`: Google would otherwise keep every voice note for
 * 55 days.
 */
export async function generateJson(
  req: GeminiJsonRequest,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GeminiJsonResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiNotConfiguredError();

  const baseFetch = opts.fetchImpl ?? fetch;
  let attempt = 0;
  const loggingFetch: typeof fetch = async (input, init) => {
    attempt += 1;
    const t0 = Date.now();
    try {
      const res = await baseFetch(input, init);
      console.info('[order-draft] gemini attempt', { ...req.logContext, attempt, status: res.status, ms: Date.now() - t0 });
      return res;
    } catch (e) {
      console.error('[order-draft] gemini attempt failed', {
        ...req.logContext,
        attempt,
        ms: Date.now() - t0,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  };

  const ai = new GoogleGenAI({ apiKey, httpOptions: { fetch: loggingFetch } });
  const started = Date.now();
  const interaction = await ai.interactions.create({
    model: GEMINI_MODEL,
    system_instruction: req.system,
    input: req.parts.map((p) =>
      p.type === 'audio'
        ? ({ type: 'audio', data: p.data, mime_type: p.mimeType } as const)
        : ({ type: 'text', text: p.text } as const),
    ),
    response_format: { type: 'text', mime_type: 'application/json', schema: req.schema },
    generation_config: { thinking_level: GEMINI_THINKING },
    store: false,
  });
  if (interaction.status !== 'completed') throw new Error(`gemini status ${interaction.status}`);

  const usage = {
    input: interaction.usage?.total_input_tokens ?? null,
    output: interaction.usage?.total_output_tokens ?? null,
    thought: interaction.usage?.total_thought_tokens ?? null,
  };
  const ms = Date.now() - started;
  console.info('[order-draft] gemini done', { ...req.logContext, model: GEMINI_MODEL, thinking: GEMINI_THINKING, attempts: attempt, ms, usage });
  return { text: interaction.output_text ?? '', usage, ms };
}

/** What to log for a failed call: the status and body say why, without the request. */
export function describeGeminiError(e: unknown): Record<string, unknown> {
  const err = e as { name?: string; status?: unknown; body?: unknown; message?: string };
  return {
    name: err?.name,
    status: typeof err?.status === 'number' ? err.status : undefined,
    body: typeof err?.body === 'string' ? err.body.slice(0, 500) : undefined,
    message: err?.message,
  };
}
