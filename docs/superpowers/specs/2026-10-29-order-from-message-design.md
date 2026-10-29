# Order from a message — Design

**Date:** 2026-10-29
**Status:** design agreed in chat, part by part; this spec is awaiting the owner's review

The owner wants to dictate an order and get a filled-in order form, using
Gemini. Today the only way to create an order is the mini app form.

## What the owner decided

- **Who speaks:** the owner (or staff) dictates the order. Forwarding a
  customer's WhatsApp voice note is a later option, not part of this build.
- **Input:** a Telegram **voice message** or **text message** sent to the bot in
  its private chat. No in-app microphone: Telegram records on every phone, while
  microphone access inside the Mini App WebView is unreliable and the owner's
  platform is unknown.
- **Nothing is saved from the message.** It produces a draft, and the owner
  opens it in the normal new-order form, checks it and saves it as usual.
- **Model:** hardcoded `gemini-3.8-flash`, thinking level `medium`. No admin
  setting (the owner's explicit choice).
- **No app-imposed length limits beyond the platforms' own.** Telegram caps a text
  message at 4,096 characters.
  - A voice message is limited by two caps, whichever comes first: a bot can
    download files of up to 20 MB, and Gemini accepts up to 20 MB per request,
    where base64 encoding adds about a third (so about 14 MB of audio). Either
    way that is well over an hour of speech.
  - Anything bigger gets "ההקלטה ארוכה מדי".
- "בהקדם" is the app's own word for ASAP and must be understood.
- **A billing-enabled Google project.** The free tier lets Google use the
  content to improve its products, and a paid project doesn't. The owner creates
  the key; a session reminder is set for 2026-10-29 17:57.

## Behaviour

### In the bot's private chat

1. A staff member sends a voice message or a text. **One message is one order.**
   A caption on the voice message is read together with it.
2. The bot replies at once with "מפענח…".
3. When Gemini is done, the bot **edits that reply** into a summary:
   ```
   דנה כהן · שבת (שישי 30/10) · משלוח
   2 × כוסמין גדול + זרעים
   הערה: לא לפרוס
   ⚠️ לא זוהה: "לחם שיפון" (לא בתפריט)
   ```
   - The summary ends with a collapsed quote, "מה ששמעתי", holding the
     transcript (for a text message, the text as Gemini read it).
   - Under it is a **"פתח הזמנה"** Mini App button, opening
     `/miniapp/orders/new?draft=<code>`.
4. **Summary lines**, all built by one shared formatter, the same one the form's
   banner uses for its warnings:

   | Case | Shown |
   |---|---|
   | One customer | The customer's name |
   | Several possible | `דנה (כמה לקוחות מתאימים)` |
   | No match | `כהן (לקוח חדש)` |
   | No name said | nothing |
   | שבת | `שבת (שישי 30/10)` |
   | בהקדם | `בהקדם` |
   | A specific date | `יום ג׳ 3/11` |
   | No date said | nothing |
   | Delivery or pickup | shown only when said |
   | No breads matched | `ללא פריטים` |
   | Warnings | one line each, from i18n |

5. **Other outcomes:**
   - **No order found:** "לא מצאתי הזמנה בהודעה", no button.
   - **Gemini or download failed:** "הפענוח נכשל, נסה לשלוח שוב".
   - **Voice message too big:** "ההקלטה ארוכה מדי".
   - **`GEMINI_API_KEY` not set:** "הזמנה מהודעה עדיין לא הוגדרה".
   - **More than one order in the message:** the first one fills in, with the
     warning "נראה שבהודעה יש יותר מהזמנה אחת, מולאה רק הראשונה".
   - **A staff member sends something else** (an audio file, a document, a
     round video, a photo, a sticker): "אפשר לשלוח הקלטה קולית או הודעת טקסט".
6. **Who it works for:** a Telegram user who is a member of the bakery with a
   role that can create orders: owner, manager or baker, **not driver**.
   - **Several bakeries:** if the user has such a role in more than one bakery,
     the first by bakery id is used. The app serves one bakery, so this is a
     documented limit, not a flow.
   - **Anyone else** (a driver, a stranger, a customer who found the bot) gets no
     reply, and the message is logged as ignored with the reason.
7. **What is never read as an order:**
   - a text starting with `/`, so commands such as `/today` and `/week` keep
     working and an unknown command isn't read as an order;
   - group chats;
   - edited messages.

### In the form

`/miniapp/orders/new?draft=<code>` opens **create mode**, filled from the
draft. A banner sits at the top:
- the line "מולא מהודעה, כדאי לבדוק לפני השמירה";
- "מה ששמעתי", collapsed, holding the full transcript;
- any warnings, in the warning style "הזמן שוב" uses but with its own wording.

**How each field fills:**

| Field | From the message | When not said |
|---|---|---|
| Breads, sizes, quantities, additions | Matched to the catalog. A bread not on the menu is left out, with a warning naming it. An addition not offered with that bread is left out, with a warning. A size not said or not matched stays empty, and the save button waits for it (as for a copied order). | The basket starts **empty**, not with a default bread. |
| Customer | **Selected** only when exactly one active customer fits: Gemini named one, and the picker's own search on the spoken name finds no other. **Several fit:** no customer is selected, and "התכוונת ל…" quick-pick buttons list them all above the search box, which holds the spoken name. **None fit:** the search box holds the spoken name, so partial matches still show, and "לקוח חדש" opens with the name filled in. | Nothing selected, as on a blank form. |
| Date and type | "לשבת" → שבת. "בהקדם", "דחוף", "כמה שיותר מהר", "עכשיו" → בהקדם. A weekday or date → that date as a specific date (but see the open question about the coming Friday). A date that can't be placed, or that has passed by the time the link is opened → a **specific date left empty** with a warning ("לא הצלחתי להבין את התאריך" / "התאריך שנאמר כבר עבר"), so the save button waits for a date. | The form's default (שבת). |
| Weekly repeat | "כל שבוע", "קבוע" → the repeat switch on, with the type above. The old שבועי type is never chosen. Not for בהקדם, as in the form. | Off. |
| Pickup or delivery | "משלוח" → delivery on; "איסוף" → off. Only while delivery is enabled in settings. The fee follows the city, as now. | The city-based suggestion runs when the customer is selected, as for any new order. |
| Notes | Anything that doesn't fit a field: "לא לפרוס", a time of day, "בשבוע הבא" with no day. Capped at the form's 1,000 characters. | Empty. |
| A reference to a past order ("כמו בפעם שעברה") | Not a note: a warning, "לא זוהה: "כמו בפעם שעברה" (אפשר ״הזמן שוב״ בכרטיס הלקוח)". | — |
| Everything else | Deals, charge additions and "notify the customer" are at their defaults for a new order. Prices are today's, from the pricing engine on save. | — |

- **A stated pickup or delivery holds** through the first customer selection
  (a quick pick, a search pick or a newly created customer). It is released only
  when the owner changes an already selected customer to another, as "הזמן שוב"
  does.
- **The draft is checked again when it opens:**
  - its lines against the menu (`copyLinesToMenu`);
  - its customer ids against the active customers;
  - its date against today in Israel time.

  So anything that changed in between is left out with a warning.
- **After a save from the draft,** the draft is marked used. Opening its link
  again shows "ההזמנה מההודעה כבר נשמרה (#N)" with a link to the order, not a
  second filled-in form. This prevents a second order and a second WhatsApp to
  the customer.
- **The link works for 7 days.** After that, or for a draft that was deleted or
  belongs to another bakery, a toast says "ההזמנה מההודעה לא נמצאה או שפג
  תוקפה" and the form opens blank.

## Open question for the owner

**The coming Friday.** In this app the שבת type is the order delivered on the
coming Friday (today, if today is Friday). When the message names that same
Friday ("לשישי", "ל-30/10", or "מחרתיים" when that is Friday), the form can show
it either way:
- **A (recommended):** as **שבת**, the way the app already files the Friday
  delivery. Any later Friday is a specific date.
- **B:** always as a **specific date**.

## Architecture

```
Telegram ──webhook──▶ /api/bot (grammY, maxDuration 300)
   message:voice / message:text (private chat, staff, not "/…")
   1. insert order_drafts … ON CONFLICT DO NOTHING RETURNING  (no row → duplicate → log, stop)
   2. try: reply "מפענח…", store its message id      (failure logged, never thrown)
   3. after(processOrderDraft(id))                   (scheduled even if step 2 failed)
   → 200 to Telegram at once
        │
        ▼
   processOrderDraft(id) — catches everything itself
     voice: bot.api.getFile(file_id) → fetch the file (≤ 20 MB, URL never logged)
     text:  the message text (+ caption for voice)
     → context: active catalog, active customers, delivery on/off, a 21-day table from israelToday()
     → gemini.ts: one Interactions call → JSON (one more call if the JSON fails validation)
     → validate → OrderDraft → row ready / empty / failed
     → edit the "מפענח…" reply into summary + button (or send a new message if there is no reply id or the edit fails)

Mini app form ── GET /api/order-drafts/<code> ──▶ { status: ready | used, draft | orderId, groupId }
   → buildPrefill(source) — shared with "הזמן שוב" → form patch + banner
   → POST /orders { …, draftId } — claims the draft, then validates and prices as now
```

### Why the work runs after the reply to Telegram

grammY's webhook handler throws after 10 seconds, and Telegram then re-sends the
update. The timeout doesn't stop the slow handler either, so both copies would
run. A Gemini call can take that long.
- **The handler does only the fast part:** the auth check, the insert, and
  "מפענח…".
- **The rest runs in Next.js `after()`.** On Vercel that keeps the function
  alive after the response, up to `maxDuration`, exported as 300 s on the bot
  route (the Hobby ceiling with Fluid compute).
- **Rules:**
  - Once the row exists, the handler never throws. The whole new handler is
    wrapped, so Telegram always gets a 200.
  - `after()` is called inside the handler's own call chain.
  - `processOrderDraft` catches and logs every error itself. Errors inside
    `after()` would otherwise only reach `console.error`, with the row stuck at
    `pending`.
- **Dedupe:** the insert is unique on (Telegram chat id, message id), with
  `ON CONFLICT DO NOTHING … RETURNING`. No row back means a re-sent update: it is
  logged and dropped. This works without transactions on neon-http.
- **A function killed mid-way** leaves the row `pending` and the reply at
  "מפענח…". The owner sends again, and the 7-day prune clears the row.

### Units

| File | Job |
|---|---|
| `src/lib/gemini.ts` (new) | The app's only call to Google, through `@google/genai` (^2.32, below 3.0). It uses `ai.interactions.create`, which Google recommends for new code; `generateContent` still works but is now legacy. Settings: `model: 'gemini-3.8-flash'`, `generation_config.thinking_level: 'medium'`, `system_instruction`, `input` (an audio part `{type:'audio', data, mime_type:'audio/ogg'}` or a text part, plus the data part), `response_format: {type:'text', mime_type:'application/json', schema}`, and **`store: false`** (by default Google keeps each interaction for 55 days). It checks `status === 'completed'`, reads `output_text`, and logs `usage.total_input_tokens / total_output_tokens / total_thought_tokens`. **Retries are the SDK's own:** 4 retries on 408/409/429/5xx and connection errors, with backoff of 0.5 s × 2ⁿ capped at 8 s per wait, honouring Retry-After. No second retry loop is added, and there's no timeout. A `fetch` wrapper handed to the SDK logs each HTTP attempt (status, ms), so retries show in the logs. Errors are read by their numeric `status`, and logged with `name`, `status` and `body`. |
| `src/lib/order-from-message.ts` (new) | The context loader, the system instruction (generic, with no bakery facts), the response schema, and **validation** of the answer into an `OrderDraft`. All of it is pure except the loader. A malformed answer gets one more call. |
| `src/lib/order-drafts.ts` (new) | DB helpers: create (dedupe insert, then prune rows over 7 days), mark ready / empty / failed, get by code, and claim on save / release on failure. |
| `src/lib/order-prefill.ts` (new) | **Pure** `buildPrefill(source, {customers, breadTypes, deliveryEnabled, today})`, returning a typed form patch plus banner data. "הזמן שוב" moves here **with byte-identical output** for a saved order, and it leaves the draft-only fields (date, repeat, hold-on-first-pick, quick picks) undefined. |
| `src/app/api/bot/route.ts` | `message:voice`, `message:text` and a catch-all for other staff messages, registered **after** every `bot.command`. Auth, the dedupe insert, "מפענח…", `after(processOrderDraft)`, and `export const maxDuration = 300`. The summary is built with `formatStaffItemLabel` and `escapeHtml`. |
| `src/app/api/order-drafts/[code]/route.ts` (new) | `GET` through `withAuth`. It loads the draft by code and requires a non-driver membership in **the draft's own bakery**, `created_at` within 7 days, and status `ready` or `used`. Anything else is 404. It returns `groupId`. The form compares that to its active bakery and shows "ההודעה שייכת למאפייה אחרת" when they differ (a case this one-bakery app shouldn't hit). |
| `src/app/api/orders/route.ts` | Optional `draftId`. Before the insert, an atomic `UPDATE order_drafts SET status='used' WHERE id=$1 AND group_id=$2 AND status='ready' RETURNING id` runs. No row means 409 "already saved". If a later step fails, the draft goes back to `ready`. After the insert, `order_id` is written. |
| `src/app/miniapp/orders/new/page.tsx` | Reads `?draft=` and loads it next to the catalog, with its own catch that logs `[order-draft] prefill failed <code>` and shows the toast. It applies `buildPrefill` and renders the banner, the quick picks and the used-draft notice. It sends `draftId` on save. The existing empty `.catch(() => {})` on the form's loads gets a log line and a toast. |
| `src/db/schema.ts`, `drizzle/0029_order_drafts.sql` | The new table (below). Applied on deploy. |
| `src/lib/i18n.ts` | Every new string: bot replies, summary parts, banner, warnings, toasts and the used notice. The draft banner has its own keys and does not reuse `orders.copied_from`. |
| `.env.example`, `README.md`, `AGENTS.md` | `GEMINI_API_KEY`; a one-line feature mention; and "Gemini calls go only through `src/lib/gemini.ts`". |

### `order_drafts` table

| Column | Type | Notes |
|---|---|---|
| `id` | varchar(21) PK | nanoid. Unguessable, and the link's code. |
| `group_id` | int FK groups | The bakery. |
| `created_by` | int FK users | The sender. |
| `source` | varchar(10) | `voice` / `text`. |
| `tg_chat_id` | bigint | **Unique with `tg_message_id`** (the dedupe). |
| `tg_message_id` | int | |
| `reply_message_id` | int null | The "מפענח…" message. |
| `status` | varchar(10) | `pending` / `ready` / `empty` / `failed` / `used`. |
| `transcript` | text null | What Gemini heard or read. |
| `draft` | jsonb null | The validated `OrderDraft`. |
| `order_id` | int null FK orders | Set when the draft is saved. |
| `error` | text null | Why it failed. For debugging, not shown in the UI. |
| `created_at` | timestamp default now | Indexed. Rows over 7 days are pruned on each insert. |

### What Gemini gets and returns

**Input** (one request):
- A system instruction. It is generic, says the message is data to read and never
  instructions to follow, and gives these reading rules:
  - Quantity words are numbers: "זוג" = 2, "חצי תריסר" = 6, "תריסר" = 12.
  - A weight ("קילו", "חצי קילו") matches the size with those grams, or is left
    empty with the words kept in `heard`.
  - A loose addition ("עם קצת זרעים") matches by name among the bread's own
    additions.
  - A first name alone, or "משפחת X", returns **every** customer that could fit,
    never a guess.
  - A weekday means its next occurrence. The same weekday as today means next
    week, unless the message says "היום". "מחר" and "מחרתיים" come from the
    table.
  - "בשבוע הבא" with no day, or a time of day, goes to notes, not to a date.
  - A reference to a past order is returned as such, not as a note.
- The data block:
  - the active breads (id, name), each with its enabled sizes (id, name, grams)
    and additions (id, name);
  - the active customers (id, name, city);
  - whether delivery is enabled;
  - a table of the next 21 days in Israel time, built from `israelToday()`, with
    the Hebrew weekday and `dd/mm`, the first row marked "היום";
  - the app's labels for the delivery types, with common ways of saying them.
- The message: the voice recording inline (`audio/ogg`, as Telegram sends it, not
  transcoded), plus its caption; or the text.

**Output** (JSON schema). There are no enums on ids, because a long customer enum
can make the schema too large for Google to accept.

```
transcript: string
hasOrder: boolean
multipleOrders: boolean
pastOrderReference: string | null
customer: { spokenName: string | null, candidateIds: number[] }
items: [{ breadTypeId: number | null, breadSizeId: number | null,
          additionIds: number[], quantity: number, heard: string }]
timing: { kind: "shabbat" | "asap" | "date" | "none", date: "YYYY-MM-DD" | null, heard: string | null }
recurring: boolean | null
delivery: boolean | null
notes: string | null
```

**Validation, before anything is stored:**
- **Schema:** zod parse first. On failure, one more call; if that also fails,
  the draft is `failed`.
- **Bread type:** an id not on the active menu (or a null one) becomes a
  `not_on_menu` warning carrying `heard`.
- **Size:** one not enabled for that type is set to null.
- **Additions:** ones not enabled for that type are removed, with a warning.
- **Quantity:** must be an integer from 1 to 999, otherwise the line is dropped
  with a warning.
- **Customer:** candidates not among the active customers are removed. Then the
  picker's search on `spokenName` is added to the candidates. Exactly one left
  means selected; more means quick picks; none means a new customer.
- **Date:**
  - a `date` that is valid and not before today (Israel time) becomes a specific
    date;
  - an invalid or past one becomes a specific date left empty, with a warning;
  - `kind: "date"` with no date (the words in `timing.heard` couldn't be placed)
    is handled the same way, with the warning carrying those words.
- **Delivery:** ignored when delivery is disabled. Recurring is ignored for
  בהקדם.
- **Notes:** trimmed to 1,000 characters.
- **Empty result:** `hasOrder` false, or nothing usable (no line and no
  customer), makes the draft `empty`.

**What the server still checks.** `POST /orders` checks that every id belongs to
the bakery and prices the order. It does **not** check that a bread or customer
is still active, so the re-check when the draft opens is what keeps inactive
ones out.

### The bot's message

- **Escaping:** every model-produced string (names, `heard`, notes, transcript)
  is escaped with `escapeHtml`.
- **Length:** the summary and warnings come first. Only the transcript quote is
  cut, ending with "…", so the message stays within Telegram's 4,096 characters
  after formatting. The form's banner shows the full transcript.
- **No nested quotes.**

## Errors and logging

Everything is logged with `console.error` / `console.info` under the
`[order-draft]` tag (the repo has no Sentry).

**Logged for each message:**
- the draft id, the sender's user id and the source;
- seconds or characters, the file size and the MIME type;
- every Gemini HTTP attempt (status, ms);
- the model, the thinking level and the token counts (input / output / thinking);
- the validation drops (counts and kinds);
- the final status.

**Logged on error:**
- every caught error, with its draft id;
- ignored senders, with the Telegram id and the reason;
- duplicate updates;
- a failed or replaced edit of the reply.

**Never logged:** customer names, the transcript (both stay in the draft row for
debugging), and the Telegram file URL, which contains the bot token. For the
download, only `file_id`, the size and the HTTP status are logged.

## Cost

About **$0.004 per message** on `gemini-3.8-flash` at today's price ($0.75 / 1M
input, $3.75 / 1M output); a 30 s voice message is about 960 audio tokens.
Thinking tokens are billed as output, so at medium thinking expect a little more.
From **2027-01-01** Google's price doubles ($1.50 / $7.50).

## Verification (nothing touches the owner's database, Telegram or Google)

1. **Offline `tsx` scripts with a fake Gemini** (in the scratchpad):
   - **Validation:** unknown ids are dropped, unoffered sizes and additions are
     cleared, and quantities out of range are dropped.
   - **Customer:**
     - one, several or no candidates;
     - a single Gemini candidate with two other customers matching the spoken
       name gives quick picks;
     - no match puts the name in the search box and the new-customer box.
   - **Dates:**
     - a past date or an unplaceable one leaves the date empty, with a warning;
     - the table is built in Israel time, including Friday 23:30 and Saturday
       00:30 Israel time while the server's clock is UTC;
     - the coming-Friday rule, once the open question is answered.
   - **Other rules:** recurring is ignored for בהקדם, delivery is ignored when
     it's off, and a past-order reference becomes a warning.
   - **Gemini calls:** a malformed answer gets one more call; the SDK's retry
     settings are what's passed; a missing key gives the "not set up" reply.
   - **The summary:** a 5,000-character transcript is cut so the message fits,
     and a `<` in a bread name is escaped.
2. **The PGlite harness** (all migrations applied):
   - **Migration:** it applies.
   - **Dedupe:** the same chat and message inserted twice gives one row.
   - **Expiry:** rows over 7 days are pruned, and an 8-day-old row that wasn't
     pruned returns 404.
   - **Who can open:**
     - `GET` returns a draft only to a non-driver of its own bakery;
     - a member of two bakeries opening the draft of the non-first one is
       handled;
     - a driver gets 403 and another bakery gets 404.
   - **Saving:** saving twice gives one order and a 409; two saves at once give
     one order; a failed save puts the draft back to `ready`.
3. **The real bot code run on fake Telegram updates,** with outgoing calls
   captured, not sent:
   - **Ignored:** a driver, a stranger, a group chat, `/today`, `/foo`, and an
     edited message.
   - **Staff messages:** a staff text gives "מפענח…", which is edited into the
     summary with the button; a staff photo gets the "voice or text" reply.
   - **Failure paths:**
     - a re-sent update is dropped;
     - when the "מפענח…" reply throws, the draft is still processed and a new
       message arrives;
     - when the edit fails, a new message with the button is sent.
4. **`buildPrefill`:**
   - copy mode's output for saved orders is identical before and after the move;
   - the draft cases: hold-on-first-pick for an ambiguous customer plus
     "משלוח"; for no match plus "משלוח" with the customer then created; and a
     past date at open.
5. **Fixture screenshots** of the form opened from a draft, light and dark, at
   390 px: the banner, the warnings, the quick picks, the new-customer prefill
   and the used-draft notice.
6. **Every check is proven** to fail with its fix removed. Then `tsc --noEmit`,
   `eslint` and `node_modules/.bin/next build` (never `npm run build`, which
   migrates prod), and an independent review of the whole branch.

**Not verifiable before deploy:** how well Gemini understands real Hebrew, the
real Telegram round trip, and whether Opus inside OGG decodes. Google lists
`audio/ogg` but doesn't name the codec, so the log line for a decode failure
names the MIME type and size. The owner tests these manually.

## Found on the way, not in scope

The app's "today" (`todayStr()`) and the שבת date (`getNextShabbatDate()`) use
the server's clock, which is UTC on Vercel.
- **The effect:** between midnight and 02:00/03:00 Israel time, "today" is still
  yesterday, and a שבת order created on Saturday night after midnight is filed
  on the Friday just gone.
- **This feature** builds its table in Israel time, so it isn't affected.
- **The existing code** is left for the owner to decide on separately.

## Non-goals

- **Forwarding customers' WhatsApp voice notes or texts.** Later. They arrive
  as audio files or documents, and will reuse `processOrderDraft`.
- **"Like last time"** filling from the customer's last order. Today it gives a
  warning pointing to "הזמן שוב".
- **Other channels and confirmations:**
  - an in-app microphone or text box in the Mini App;
  - saving an order straight from the message, or confirming it in the chat.
- **More than one order per message.**
- **An admin setting** for the model or the thinking level.
- **Editing a draft from the chat, and group chats.**
