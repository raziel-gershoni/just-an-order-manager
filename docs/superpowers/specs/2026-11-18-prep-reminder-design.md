# Day-before prep reminder

Status: approved 2026-11-18 (owner chose the times).

## Why

Bakers get today's bake at 06:00 on the baking day. Sourdough work starts the day before: feeding the starters, cooking the tangzhong. So a second message the day before tells the baker what tomorrow needs, early enough to start.

## What

- **One message per bakery the day before a baking day,** to the bakers only, the same recipients as the morning summary (`getRecipientsByRole(groupId, ['baker'])`). Nothing is sent when nothing is ordered for tomorrow.
- **When** (Israel time):
  - Sunday to Friday: 06:00, for the next day.
  - Saturday: 20:00, for Sunday. This is after Shabbat ends for most of the year. In midsummer Shabbat ends around 20:30; the owner accepted this.
- **"Tomorrow's orders"** are the bakery's orders dated tomorrow whose status is not cancelled or delivered, the same status filter as the morning summary. Undated (בהקדם) orders are not part of it; they stay in the morning message.
- **The text** (Hebrew, Telegram HTML):
  ```
  📋 מחר אופים, זמן להתחיל הכנות
  יום ו׳ 20.11

  כפרי 750 ג׳: 8 כיכרות
  שיפון: 4 כיכרות
  סה״כ מחר: 12 כיכרות

  להכין:
  מחמצת שיפון 1150ג (קמח שיפון 575ג · מים 575ג)
  טנזונג 300ג (קמח לבן 50ג · מים 250ג)
  מחמצת כוסמין 400ג
  ```
  - **Bread lines** use the same staff labels as the morning summary (type, size, additions), with total loaves per label. The message has no customer names: for preparation, the totals are what count.
  - **"להכין"** lists every starter-kind and tangzhong-kind ingredient in tomorrow's scaled recipes, summed across breads by name and kind. Each line shows its total grams. When that home-made ingredient has settings with a flour, its split is shown in parentheses: flour = total × 100/(100+h), liquid = total × h/(100+h), using the settings' flour and liquid names. With no settings, the line shows the total only.
  - Grams are rounded to whole grams, the same as the morning recipe block.
  - Breads with no recipe, or a size with no weight, contribute nothing to "להכין", the same as the morning recipe block.
  - The "להכין" heading is left out when there is nothing to prepare.
- **Limit:** it shows how much of each starter tomorrow needs and what that amount is made of, not how to build it from the seed starter (the feeding ratio is not stored).

## How

- **A new cron route,** `/api/cron/prep-reminder` (POST only, `CRON_SECRET`), the same shape as the morning reminder. One schedule in `scripts/provision-schedules.ts`: `razei-prep-reminder`, `CRON_TZ=Asia/Jerusalem 0 6,20 * * *`.
  - The handler sends only in the right slot: on Saturday only in the evening run (Israel hour ≥ 12), and on other days only in the morning run (hour < 12). It logs and returns 200 otherwise.
  - It is separate from the morning reminder, so its work can't push that one over its time limit and make QStash resend its messages.
- **Code reuse:**
  - Tomorrow's orders and bread lines come from `src/lib/day-digest.ts` (`bakeLines`).
  - The scaled recipes come from `aggregateRecipesForOrders` (`src/lib/order-recipe.ts`).
  - The home-made settings come from `loadHomeMade` (`src/lib/ingredient-costs.ts`).
  - The day label uses `formatWeekdayShort` and `formatDayMonth` from `src/lib/date-utils.ts`.
  - The Israel hour comes from a new `israelHour(now)` in date-utils (Intl, Asia/Jerusalem).
  - Building the message is a pure function, so it can be tested offline.
- **Strings** are in `src/lib/i18n.ts`.
- **Logging:** a `[cron/prep-reminder]` line per group, with sent and failed counts, and every error.
