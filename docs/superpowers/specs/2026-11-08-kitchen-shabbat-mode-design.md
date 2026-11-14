# Kitchen screen: Shabbat mode

Approved by the owner on 2026-11-08 ("this looks fantastic start developing"), after a mockup.

## Goal

From candle lighting (20 minutes before sunset) on the eve of a Shabbat or Yom Tov until it ends (צאת השבת / צאת החג), the kitchen screen (`/kitchen`) shows a Shabbat view instead of the orders: lit candles, a greeting, the parasha or holiday, the Hebrew date, the candle-lighting and end times, and the next prayer times. After the end it shows the orders again by itself.

Yom Tov follows the Israeli calendar: both days of ראש השנה, יום כיפור, the first day of סוכות, שמיני עצרת, the first and seventh days of פסח, and שבועות. A Yom Tov next to a Shabbat is one stretch.

## Owner decisions

- **Times come from famcal**, the owner's own app (https://famcal.bot), through its Jewish times API v1 (reference: famcal repo `docs/api/jewish-times-v1.md`). This repo has no zmanim or holiday logic of its own. famcal is never changed from this repo.
- **The screen keeps polling on Shabbat.** The screen will later show emergency alerts on Shabbat (Gal Shaket). Only what it shows changes; polling, new data, reload after a deploy and "המסך נותק" work as on any other day.
- **The four greetings:**
  - גמר חתימה טובה if the stretch has יום כיפור;
  - otherwise שבת שלום וחג שמח if it has both Shabbat and a Yom Tov day;
  - otherwise חג שמח for Yom Tov alone (ראש השנה too);
  - otherwise שבת שלום.
- **What the screen shows:** the mockup the owner approved (the 2026-11-08 session): candles, greeting, occasion, Hebrew date, a two-time panel, "הזמנים הבאים", the return line, and famcal's credits.
- **City:** one of famcal's 51 Israeli cities.
  - If the bakery's city (`groups.delivery_home_city`, the delivery settings' free text) matches one of them, it is filled in automatically.
  - Otherwise the owner picks the nearest city once.
  - There is no geocoding of the town name: that would mean another outside service and another credit line, for a setting chosen once.
- **Community** (famcal's word is "מנהג"): ספרדי (the default), אשכנזי or חב״ד. It decides the end time and the zmanim opinions.
- **famcal's credits** are shown wherever its times are shown: on the Shabbat view and under the settings preview. They are English text, as given, not translated.
- `FAMCAL_API_KEY` is set in Vercel (the owner made a server key in famcal's admin panel).

## famcal API used

Base `https://famcal.bot/api/v1/`, `Authorization: Bearer $FAMCAL_API_KEY`, every call with `city`, `community` and `lang=he`. An unknown or repeated parameter is a 400, so nothing else is sent.

- **`GET /shabbat?city&community&lang=he&from&to`** returns `{ blocks, credits }`.
  - Each block is `{ eve, last, candleLighting:{at,local}, start:{at,local}, end:{key,name,at,local}|null, parasha, holidays:[{title,brief,kind,chag}], days }`.
  - A block is every Shabbat or Yom Tov stretch whose eve falls in `[from, to]`, plus one already under way on `from`.
- **`GET /day?city&community&lang=he&date`** returns:
  - `hebrewDate: {gematriya, day, month}`, where `month` is the English month name meant for programs, e.g. `Tishrei`;
  - `holidays: [{title,brief,kind,chag}]`;
  - `rows: [{key,opinion,name,at,local}]`;
  - `credits`.
- **Times:** `at` is ISO with the offset; `local` is hh:mm.
- **Errors:** `{ error: { code, message } }`, with 400/401/403/404, 429 (`Retry-After`), 500, and 503 `KEYS_UNAVAILABLE`.
- **Limits:** 300 requests a minute per key; a `/shabbat` range of at most 366 days.

## Design

### Data the app keeps

- **`groups.shabbat_city`** `varchar(64)` null. A famcal city slug; null means the mode is off.
- **`groups.shabbat_community`** `varchar(16)` not null, default `'sephardi'`.
- **New table `shabbat_times`**, one row per bakery: `group_id` (primary key, references groups), `data` jsonb, `updated_at`. It is a table of its own because `GET /api/groups/:id` sends the whole groups row to the mini app.
  - `data` holds what was fetched: `{ city, community, through, fetchedAt, credits, blocks }`.
  - `through` is the last eve the fetch covered.
  - The reader uses the row only when its `city` and `community` match the groups row, so stale times never show for a changed setting.
- **Each stored block:**
  - `eve`, `last`;
  - `start`: the eve's candle lighting, a UTC ISO instant;
  - `end`: the stretch's end, a UTC ISO instant;
  - `endName`: famcal's Hebrew name for the end, "צאת השבת" or "צאת החג";
  - `greeting`;
  - `days`: the rest days, each with `date`, `hebrewDate` (gematriya), `occasion` and `sunset`;
  - `rows`: the timeline of prayer times from the eve to the last day, after `start`.
- **`occasion`** is the day's famcal holiday title by priority: Yom Tov (`chag`), then חול המועד, then a special Shabbat, then the parasha. It can be null.
- **The rows shown** (famcal keys, in famcal's Hebrew names with the opinion, e.g. "סוף זמן קריאת שמע (מג״א)"):
  - `NETZ`, `SOF_SHMA_MGA`, `SOF_SHMA_GRA`, `SOF_TFILA`, `CHATZOT`, `MINCHA_GEDOLA`;
  - `PLAG_HALACHA_BERURA`, `PLAG_YALKUT_YOSEF`, `PLAG_GRA`;
  - `SHKIA`, `CANDLE_LIGHTING`, `CANDLE_LIGHTING_NOT_BEFORE`.

  Each community has its own subset. Left out on purpose: dawn, misheyakir, mincha ketana, the nightfalls, midnight, and the end rows (the end is in the panel).

### Fetching (src/lib/famcal.ts, src/lib/shabbat-build.ts, src/lib/shabbat-times.ts)

- **`src/lib/famcal.ts` is the only famcal client.** It sends `GET` with the bearer key and `cache: 'no-store'`, and has no timeout of its own.
  - **Retries:** network errors, 429 and 5xx are retried with `p-retry`: 3 retries, exponential backoff from 1 s (factor 2, randomized).
  - **No retry:** other 4xx responses, an answer that isn't JSON, and an answer that fails the zod schema.
  - **Logging:** every failed attempt is logged with `[famcal]`, the path, the status and famcal's error code. The key is never logged.
  - A missing `FAMCAL_API_KEY` fails at once with code `NO_KEY`, without a request.
  - Unknown fields in an answer are ignored, because famcal's v1 adds fields.
- **One fetch**, from today to today + 35 days:
  - one `/shabbat` call;
  - a `/day` call for every day from each block's eve to its last day, in parallel. That's about 15 requests.
  - If any request still fails after its retries, the whole fetch fails and nothing is written.
  - A block whose candle lighting or end is null is skipped with a warning. This doesn't happen in Israel.
  - The credits are the union of all answers' credits, one per source.
- **Saving the setting** (`PUT /api/groups/:id/shabbat`, owners and managers):
  - **Turning the mode on, or changing city or community:** fetch first. On success, write the times row, then the groups columns. On failure nothing is written: 502 `famcal_failed`, or 503 `famcal_no_key`.
  - **Turning it off:** clear the city and delete the times row, with no famcal call.
  - Either write marks the kitchen copy stale through the write hook, so the screen picks it up on its next poll.
- **The 06:00 morning job** (`/api/cron/morning-reminder`), for every bakery with a city:
  - It refreshes the times in its own try block. A failure is logged and the old times stay.
  - The write is conditional, in one SQL statement: it lands only if the groups row still has the city and community that were fetched.
  - **Warning:** if the stored times cover fewer than 8 days ahead (none at all, or `through < today + 8`), the owner and managers get a Telegram warning that day. It names the last covered day and says to check famcal and `FAMCAL_API_KEY`. Daily refreshes of 35 days mean famcal can be down for about four weeks before this fires.

### Kitchen data and screen

- **`KitchenData.shabbat`** is `{ blocks, credits } | null`.
  - It is null when the mode is off or no matching times are stored.
  - `blocks` keeps only the stretches with `last >= today` and `eve <= today + 8`, so the payload stays small.
  - It is part of the same cached copy and stamp.
- **`KitchenScreen`** keeps a `now` value.
  - It starts from `renderedAt`, so the server render and hydration match, then follows the phone's clock.
  - It updates at the next start, end, sunset or row time, and at least every 60 s.
  - The active stretch is the one with `start <= now < end`.
  - When one is active, it renders `ShabbatScreen` in place of the sheets and the dock. Otherwise it renders as today.
  - Polling and the wake lock are untouched.
- **`ShabbatScreen`** (pure render) shows:
  - the lights: an inline SVG line drawing of two olive-oil glasses on a tray, because the icon library has none; only the flames are coloured, and nothing moves (the first version was flickering wax candles, replaced at the owner's request on 2026-11-14);
  - the greeting;
  - the occasion and Hebrew date of the current rest day: the first rest day whose sunset hasn't passed, or the last day;
  - a panel with הדלקת נרות and `endName`;
  - "הזמנים הבאים": the next 4 rows of the stretch still ahead, the nearest in bold, omitted when none are left;
  - "ההזמנות יחזרו למסך ב־HH:MM";
  - the credits, tiny and LTR.

  Times show on Israel's clock, as hh:mm, with `dir="ltr"` on the digits only. The styles extend `KITCHEN_CSS` with the kitchen tokens plus candle tokens, light and dark. On short screens (height ≤ 700px) everything shrinks a step and only 3 rows show.

### Settings (KitchenScreenCard)

A "מצב שבת" switch with a hint, loaded from `GET /api/groups/:id/shabbat`. That returns:
- `city`, `community`;
- `suggestedCity`: the bakery city matched to famcal's list, or null;
- `homeCity`;
- `next`: the next stretch's times and occasion;
- `credits`.

How it behaves:
- **On**, it shows a city select (51 cities sorted by Hebrew name), a "מנהג" select, a preview of the next stretch (occasion, candle lighting and end with weekday and date), and the credits.
- **Turning it on** saves at once with the suggested city. Without a suggestion, it shows the select with "בחרו עיר" and a hint naming the bakery city that wasn't found, and saves when a city is picked.
- **Any change** disables the controls and shows "מעדכן זמנים מ־famcal…". A failure reverts the control and shows a toast saying famcal didn't answer, or that the key is missing.
- **A failed load** shows `LoadError` (compact) instead of the controls.

### City list (src/lib/famcal-cities.ts)

famcal's 51 Israeli slugs with their Hebrew names (from famcal's `messages/he.json`), sorted by Hebrew name. It's client-safe.

`matchFamcalCity(text)` compares after normalizing:
- trim, drop niqqud and quote marks, treat hyphens as spaces;
- fold doubled ו and י (so קריית matches קרית and תקווה matches תקוה);
- a few aliases: תל אביב יפו, מודיעין מכבים רעות, נצרת עילית;
- Latin text compared with the slug.

Limit: a city famcal adds later won't appear until this list is updated.

## Errors and logging

- Every caught error is logged with a tag: `[famcal]`, `[shabbat]`, `[cron/morning-reminder]`, `[kitchen]`.
- A failed save shows a toast. A failed refresh keeps the old times.
- No silent catches.

## Testing (offline only)

All tests run on PGlite with every migration and a faked `fetch`. Nothing reaches famcal, Telegram or the real database.

- **famcal client:**
  - the request it sends: URL, parameters, key;
  - retries on 5xx, 429 and network errors;
  - no retry on 4xx, bad JSON or a wrong shape;
  - the missing key.
- **The builder:** every greeting case (Shabbat, Yom Tov into Shabbat, Shabbat into Yom Tov, midweek Yom Tov, ראש השנה Thursday–Friday into Shabbat, יום כיפור on a weekday and on Shabbat), the occasion priority, the row filter, null times and the credits union.
- **The view:** stretch boundaries (start included, end not), the current day switching at sunset, the next 4 rows, the 8-day window and the next update time.
- **Storage:** save, failure writing nothing, off, the conditional refresh, a mismatched row ignored, coverage, and the kitchen data.
- **Route:** roles, validation, 502 and 503, and the response shape.
- **Cron:** refresh, failure keeping the old times, and the warning text.
- **UI:** server renders of each greeting; the kitchen screen switching on a fake clock while polling continues (jsdom); the settings states.
- **Screenshots:** light and dark at 390×780 and 360×640.
- **Deliberate code breaks** to make sure the tests catch them.
- **The gate:** tsc, eslint and an offline `next build`.

## Not in scope

- Gal Shaket alerts.
- Geocoding the town.
- Any change in famcal.
- Showing the screen differently in the hours before candle lighting.
- Taking the owner's own famcal location. famcal's v1 has no way to do that; it would need a famcal change, for example an API key bound to the owner's famcal account plus a `place=account` parameter, so famcal uses that account's saved place and community without ever sending the coordinates out. The famcal call names the place in one spot (`src/lib/famcal.ts`), so moving to that later is a small change.
