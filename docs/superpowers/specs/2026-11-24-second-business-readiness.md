# Readiness for a second, non-baking business

Status: assessment only, 2026-11-24. The owner asked this as a theoretical question; nothing is planned. One fix came out of it and shipped the same day (invite-only signup, see "Fixed").

## The question

Could the app take on another business outside baking, such as a florist, caterer, soap maker, butcher or laundry? How far is it from being configurable per business and per domain? And what hosting and hardware would that need?

## Verdict

**Not ready today, but closer than the June 2026 "one bakery only" decision suggests.**

- The data foundation already supports several businesses.
- The product built on top of it is still a single bakery: one bot, one WhatsApp number, one public site, bread wording, and bread-only screens that can't be switched off.
- The hosting plan, not the hardware, is the first real limit.

## How this was checked

The code was audited read-only along five lines:
- tenancy and onboarding;
- data isolation between businesses;
- coupling to baking;
- localization and branding;
- infrastructure and hardware.

Every finding rated major or blocker was then re-checked by a second reviewer against the code. External limits and prices were checked online on 2026-11-24.

## What already works per business

- **Data is separated.**
  - Every business table carries `group_id`. `withGroup` (`src/lib/api-utils.ts`) requires the caller to be a member of the group they ask for, and the bot mirrors this (`resolveBotOrderAccess`, `src/lib/telegram-auth.ts`).
  - A sweep of every API route, the bot, MCP, crons, notifications, the kitchen cache and export tokens found no path where one business's staff can read or change another's orders, customers, payments, recipes, prices or reports.
  - Gaps: the separation exists only in app code. There is no database-level guard (Postgres row-level security) and there are no automated isolation tests.
- **Per-business already:**
  - the kitchen-screen pairing and the MCP key;
  - logo and storefront content (`bakery_profile`), and the delivery settings and home address;
  - Shabbat city, `asap_in_today`, the recurring-reminder switch and the additions surcharge.
- **Generic logic that fits other businesses as is:**
  - customers and phones, and orders;
  - the payments ledger and balances, prepaid orders and the income report;
  - delivery and route order, WhatsApp and Telegram notifications, recurring orders;
  - orders read from messages (Gemini gets the business's own catalogue as data, not a fixed menu).
- **Pricing** (`src/lib/pricing.ts`) works for anything sold at a fixed price per item: product × size, quantity deals, cheapest combination.
- **Order flow:** the status flow can skip the "baking" step (confirmed → ready).
- **Scheduled jobs** loop over every business and keep one business's failure from stopping the others.

## What is in the way

Severities are as corrected by the second reviewer. Effort assumes one developer working with an AI agent.

1. **One identity per installation.** Major, about a week.
   - One Telegram bot (`TELEGRAM_BOT_TOKEN`).
   - One WhatsApp number and template set (`WHATSAPP_PHONE_ID`, `src/lib/whatsapp.ts`).
   - One public site (`PUBLIC_SITE_GROUP_ID`, `src/lib/public-site.ts`), which also owns the sitemap, manifest and icons. `bakery_profile.slug` is reserved but unused.
   - The brand name "רזי הלחם" and the JSON-LD type `Bakery` appear in code fallbacks and SEO copy.
   - Effect: a second business's customers would get WhatsApp from the bakery's number. An unknown WhatsApp sender is forwarded to the public-site business.
2. **A person in two businesses always lands in the older one.** Major for that person, days.
   - The Mini App takes `groups[0]` (`src/app/miniapp/layout.tsx`).
   - The bot's /today and /week use the first group (`src/app/api/bot/route.ts`).
   - Voice and text order drafts go to the lowest group id (`src/lib/order-draft-process.ts`).
   - There's no switcher, and notifications don't name the business.
3. **Bread modules can't be switched off per business.** Major, 2–4 days.
   - Affected: recipes, ingredient costs, home-made starters and tangzhong, hydration, the baker screen, the prep reminder, the mix and shape parts of the print sheet, and the MCP recipe and cost tools.
   - With no recipe data, nothing breaks and nothing extra is sent, but the screens and menu entries are still there.
   - Fix: a per-group modules setting that gates the nav, settings sections, cron loops, print-sheet sections, the kitchen block and MCP tool registration.
4. **The wording is bread wording.** Major, 2–3 days.
   - `src/lib/i18n.ts` is one flat Hebrew map of about 900 keys, and dozens use לחם, כיכרות, אופה, באפייה or מאפייה.
   - `baker` is a stored role and `baking` a stored order status.
   - The tables are named `bread_types`, `bread_sizes` and `bread_additions`. That is naming only, and the shapes are generic.
   - Fix: relabel through a per-business glossary. Don't rename tables or enum values.
5. **The week is built around Friday.** Major for a business with a different week, days.
   - Delivery types `shabbat` and `weekly` both mean the coming Friday, and a new order defaults to `shabbat`.
   - Recurring orders are weekly, on Friday.
   - Cron times are fixed for every business in `scripts/provision-schedules.ts`: 06:00 morning, prep at 06:00 and Saturday 20:00, recurring reminders 10:00 Sunday and Wednesday, Shabbat refresh 05:30, weekly summary Saturday 21:00.
6. **Pricing limits, depending on the business.** Major for some, none for others.
   - Quantity is a whole number, so per-kilo pricing (a butcher) doesn't fit.
   - Add-ons have one flat surcharge per business.
   - No VAT, no quotes, no hourly services.
   - Fixed-price goods (bouquets, soap, catering trays) fit as is.
7. **Israel-only assumptions.** Minor for an Israeli business.
   - Hebrew and right-to-left only, shekels, Israel time, +972 phones.
   - Hebrew dates and Shabbat mode (famcal).
8. **A second installation of the same code would break the bakery's scheduled jobs.** Must fix before such an installation, hours.
   - `scripts/provision-schedules.ts` uses fixed schedule ids (`razei-*`) and a hardcoded `CANONICAL_BASE_URL`.
   - A second Vercel project sharing the same QStash account would overwrite the bakery's schedules with its own `CRON_SECRET`.
   - The bakery's crons would then get 401 and its daily messages would stop.
   - Fix: take the schedule-id prefix and host from configuration.

## Hosting and hardware

- **Vercel plan terms.**
  - The Terms (updated 2026-10-19) say: "You shall only use the Services under a Hobby plan for your personal or non-commercial use."
  - The project's plan was not visible during the audit. A code comment (`src/app/api/bot/route.ts`, "300 s is the Hobby ceiling") suggests Hobby.
  - A bakery is arguably commercial already, and a second business makes it clear.
  - Pro is $20 per developer seat per month, with usage billed beyond the included credit ($0.60 per 1M invocations).
- **Load.**
  - The heaviest steady load is the kitchen screen polling `/api/kitchen/state` every 30 s, day and night (`src/components/kitchen/KitchenScreen.tsx`). That is about 86,400 calls per screen per month. Each poll is cheap: it reads a cached copy and doesn't touch the database unless something was saved.
  - Hobby includes 1M invocations and 4 Active CPU-hours a month. Estimate: one bakery uses about 10–15% of the invocations, and around 10 always-on screens would reach the cap. CPU per poll was not measured.
  - Scheduled jobs don't multiply per business: there are 5 QStash schedules, each looping over all businesses inside a 60 s function. That's fine for a handful of businesses, not dozens.
- **Other free tiers** (checked 2026-11-24):

  | Service | Free allowance |
  | --- | --- |
  | Neon | 1 GB storage, 100 CU-hours per project per month |
  | Vercel Blob | 1 GB |
  | QStash | 1,000 messages a day, 10 active schedules. The account is shared with other projects. |
  | Google Maps | 10,000 free Geocoding and Route Matrix events a month each |

  None of these is the first limit to break.
- **Costs that grow per business:**
  - WhatsApp: per delivered template message, by category and country.
  - Gemini: the Flash model, $0.75 / $3.75 per 1M input / output tokens until 2026-12-31, then $1.50 / $7.50.
  - Google Maps beyond the free events.
  - Today none of these is metered or capped per business.
- **On-site hardware.**
  - The kitchen screen is any phone or tablet browser, paired by QR, using a screen wake lock.
  - Printing is A4 from the browser.
  - There's no receipt or label printer, scale, barcode, card terminal or POS integration. A business that needs any of those (a counter shop, a butcher weighing to order) means a separate project.

## Two ways to do it

**A. Recommended for a second business: the same code, installed a second time.**
- The second installation gets its own Vercel project, Neon database, Telegram bot, WhatsApp number and templates, and domain.
- It's the same repo, not a fork. Separation comes for free, and the per-installation singletons become environment variables.
- Still needed in the shared code:
  - the modules switch (item 3);
  - the glossary (item 4);
  - the brand and SEO fallbacks from settings (item 1, about a day);
  - a usual-delivery-day setting (item 5);
  - the schedule-id fix (item 8).
- Setup takes 1–2 days. Roughly 1.5–2 weeks in all.

**B. Several businesses in one installation.**
- Everything in A, plus:
  - a business switcher, with the business named on every message (item 2);
  - a storefront per business, chosen by domain;
  - a WhatsApp number and templates per business, with inbound routing by number;
  - cron times per business;
  - isolation tests or row-level security;
  - per-business limits on the paid services.
- Roughly 3–5 weeks. Worth it from about the third business.

A deeper generalisation (renaming tables, per-kilo quantities, VAT, quotes) is only worth doing for a business that needs it.

## Fixed: invite-only signup (2026-11-24)

**The hole.**
- A Telegram user who opened the Mini App with no business saw the "הקמת המאפייה" card. It called `POST /api/groups`, which accepted any signed-in user, and the caller became the owner of a new business.
- From there they could reach the paid keys (Gemini through order drafts, Google Maps, famcal).
- WhatsApp abuse was limited, because a template must already be approved on the bakery's number.

**Checked in production, read-only, on 2026-11-24.**
- Nobody had used it: the bakery is the only business, with its two members.
- Four other Telegram users had opened the app (Aug–Nov 2026) and stopped at the setup card. They have user rows only, and no business or membership.

**The fix.**
- `canCreateGroup()` (`src/lib/group-signup.ts`) allows setup only when the database has no business at all, so the first person on a fresh installation becomes its owner. It is shared by:
  - `POST /api/groups`, which refuses with 403 and logs the refusal;
  - `GET /api/auth/me`, which tells the Mini App whether to show the setup card.
- Everyone else sees "האפליקציה מיועדת לצוות המאפייה. כדי להצטרף צריך קישור הזמנה." and joins through an invite link.
- Accepting an invite on the in-app join screen (`/miniapp/join/[code]`) now opens the newly joined business when the user had none. Before, the home screen kept the list of businesses it loaded on start, so the user landed on the setup card, and now would land on the invite-only text, until they reopened the app.
- Limit: on an empty installation, two people opening the app at the same instant could both pass. That only happens on a fresh deploy.

## Open questions, if this ever becomes real

- Which business is it? That decides pricing fit (per kilo?) and hardware (scale, receipts).
- Same owner or a separate party? A separate party rules out sharing the bot and WhatsApp number.
- Which Vercel plan is the project on?
