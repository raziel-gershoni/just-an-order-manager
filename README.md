# Just an Order Manager
> A Telegram-native order-management system for a working bakery — staff run the shop from inside Telegram, customers get an SEO price-list site, all from one Next.js codebase.

![Next.js 16](https://img.shields.io/badge/Next.js%2016-000?style=flat-square&logo=next.js&logoColor=white)
![React 19](https://img.shields.io/badge/React%2019-20232a?style=flat-square&logo=react&logoColor=61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Neon Postgres](https://img.shields.io/badge/Neon%20Postgres-336791?style=flat-square&logo=postgresql&logoColor=white)
![Drizzle ORM](https://img.shields.io/badge/Drizzle%20ORM-c5f74f?style=flat-square&logo=drizzle&logoColor=black)
![Telegram Mini App](https://img.shields.io/badge/Telegram%20Mini%20App-26a5e4?style=flat-square&logo=telegram&logoColor=white)
![Tailwind v4](https://img.shields.io/badge/Tailwind%20v4-38bdf8?style=flat-square&logo=tailwindcss&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000?style=flat-square&logo=vercel&logoColor=white)
[![demo · live](https://img.shields.io/badge/demo-live-brightgreen?style=flat-square)](https://www.razeilechem.co.il)

**🔗 Live demo:** [www.razeilechem.co.il](https://www.razeilechem.co.il) (public bakery site — open to everyone) · also at [just-an-order-manager.vercel.app](https://just-an-order-manager.vercel.app). The staff app is a Telegram Mini App, so it opens through the bakery's Telegram bot rather than in a plain browser.

This is the production order system for a real Israeli bakery. Staff take, price, and fulfill bread orders entirely inside Telegram; customers browse a fast, structured-data price list on the public web. One Next.js codebase serves four surfaces at once — a Telegram Mini App, a Telegram chat bot, WhatsApp customer reminders, and a public SEO/marketing site — over a multi-tenant, role-based Postgres backend.

<!-- Screenshot placeholder: leave exactly this HTML comment so the owner can drop an image in later:
     ![screenshot](docs/screenshot.png) -->

## ✨ Features
- **Take orders from inside Telegram** — a Mini App for full order entry, plus a chat bot with inline buttons for quick status changes and payments on the go.
- **Tiered bulk pricing** — bread sizes offer bundle tiers (e.g. 6 for a pack price, 30 for another); the system automatically charges customers the cheapest valid combination of packs and singles.
- **Order lifecycle workflow** — pending → confirmed → baking → ready → delivered, with cancellation, driven by one shared state machine for both web and bot.
- **Recurring orders** — standing orders auto-generate their next occurrence when the current one is delivered.
- **Payments & customer balances** — record payments, auto-charge on delivery, and track running per-customer balances with a debt threshold.
- **Deliveries with a driver role** — delivery addresses, per-city routing, and a dedicated driver view.
- **Automated customer reminders** — scheduled WhatsApp reminders (week-start and Shabbat) and "order ready" notifications via the WhatsApp Business Cloud API.
- **Recipes** — per-bread recipes and ingredient lists, surfaced to bakers alongside the day's orders.
- **Public SEO site** — a per-bakery marketing page with the live price list, sitemap, robots, Schema.org JSON-LD, and Open Graph / Twitter images.
- **Multi-tenant & role-based** — groups with owner / manager / baker / driver roles and an invite flow, so each tenant's data and capabilities stay isolated.
- **Hebrew / RTL first** — the staff and customer surfaces are built Hebrew-first, including Hebrew-calendar (Shabbat) awareness.

## 🏗️ How it works

**A single pricing engine as the source of truth.** All money flows through one pure, DB-free bulk-pricing engine (`src/lib/pricing.ts`) wrapped by a DB-facing layer (`src/lib/order-pricing.ts`), so every read and write path prices an order identically. The engine works entirely in integer agorot to avoid floating-point drift and treats bundle allocation as an optimization problem: a dynamic program over units (sorted by price, with "free-rider" slots for pack members) finds the genuinely cheapest arrangement of tiers and singles for any quantity, concentrating the priciest breads into the fewest packs. It returns both the total and a human-readable breakdown of the packs and singles chosen.

**One state machine, two front ends.** Order status transitions are defined once (`ORDER_STATUS_TRANSITIONS`) and executed by a single `transitionOrderStatus` function shared by the web `PATCH` route and the bot's inline buttons. Because Neon's HTTP driver has no interactive transactions, the transition uses an atomic compare-and-swap on the status column as its serialization point — only the request that actually flips the status runs the side effects, so a double-tap or retry loses the race cleanly. All side effects after the commit (auto-charge, recurring clone, WhatsApp/Telegram notifications) are best-effort and logged rather than thrown, so a flaky notification never 500s a completed delivery.

**Telegram auth, mirrored on both sides.** Mini App requests are authenticated by verifying Telegram `initData` with the documented HMAC-SHA256 scheme and an auth-date freshness check (`src/lib/telegram-auth.ts`). Crucially, the bot enforces the same authorization as the web layer: because order IDs are global, `resolveBotOrderAccess` resolves the Telegram user, loads the target order, and requires a matching group-membership row before any callback runs — so a crafted callback can't reach across tenants. Invite acceptance is likewise guarded in one shared place (`respondToInvite`) for both web and bot.

**Multi-channel from one codebase.** The same App Router project renders React Server Components for the Telegram Mini App, exposes a grammY webhook for the chat bot, calls the WhatsApp Business Cloud API for reminders, and serves a public marketing site with full SEO metadata (dynamic `sitemap.ts` / `robots.ts`, a Schema.org `Bakery` JSON-LD node built from live catalog data, static Open Graph / Twitter images, and app icons generated via `next/og`). Scheduled work (morning reminders, weekly summaries) runs as cron-guarded API routes authorized by a bearer `CRON_SECRET`.

**Details that come from running in production.** Phone numbers are normalized to strip invisible bidi-control and isolate marks (U+200E/200F, U+202A–202E, U+2066–2069) that get baked into a number when it's typed or pasted into an RTL Hebrew field — a class of bug that silently failed WhatsApp sends. The 22-table Postgres schema is managed by 20 sequential Drizzle migrations that run automatically at build time before `next build`, so a deploy can never ship code ahead of its schema.

## 🛠️ Tech stack
- **Frontend:** Next.js 16 (App Router, React Server Components, ISR), React 19, TypeScript, Tailwind CSS v4, shadcn-style UI (class-variance-authority, lucide-react, sonner), Hebrew/RTL.
- **Telegram:** `@telegram-apps/sdk` and `@telegram-apps/init-data-node` for the Mini App; `grammy` for the chat bot webhook.
- **Backend/API:** Next.js Route Handlers, Zod validation, WhatsApp Business Cloud API, `@hebcal/hdate` for Hebrew-calendar dates.
- **Data:** Neon serverless Postgres via `@neondatabase/serverless`, Drizzle ORM + drizzle-kit (22 tables, 20 migrations).
- **Infra:** Vercel (hosting, cron, Blob image storage), build-time migrations, custom domain + Vercel URL.

## 🚀 Getting started

### Prerequisites
- Node.js 20+
- [pnpm](https://pnpm.io/)
- A Neon (or other) Postgres database
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- (Optional) WhatsApp Business Cloud API credentials and a Vercel Blob store for the customer reminders and public image library

### Environment variables
Copy `.env.example` to `.env.local` and fill in the values. Never commit real secrets.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon Postgres connection string |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Secret used to verify Telegram webhook calls |
| `NEXT_PUBLIC_BOT_USERNAME` | Bot username (used in public links) |
| `NEXT_PUBLIC_APP_URL` | Canonical public origin (drives canonical/OG/sitemap/robots and the Mini App URL) |
| `CRON_SECRET` | Bearer secret authorizing the scheduled cron routes |
| `WHATSAPP_TOKEN` | WhatsApp Business Cloud API token |
| `WHATSAPP_PHONE_ID` | WhatsApp sender phone number ID |
| `WHATSAPP_TEMPLATE_NAME` | Message template name (e.g. `order_ready`) |
| `DEFAULT_BREAD_PRICE` | Fallback unit price when a bread type has none set |
| `PUBLIC_SITE_GROUP_ID` | Which group's bakery is served at the root URL |
| `DEPLOY_NOTIFY_CHAT_ID` | (Optional) Telegram chat to notify on each successful deploy |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for the public image library |

### Install & run
```bash
# install dependencies
pnpm install

# apply database migrations
pnpm db:migrate

# start the dev server on http://localhost:3000
pnpm dev

# production build (runs migrations, then builds)
pnpm build
pnpm start
```

Drizzle helpers: `pnpm db:generate` (generate SQL from schema changes), `pnpm db:push`, and `pnpm db:studio`.

## 📦 Deployment
Deployed on Vercel. The build step runs the Drizzle migrations (`tsx scripts/migrate.ts`) before `next build`, so the database schema is always advanced ahead of the new code, and posts a Telegram deploy notification on success. Scheduled jobs (morning reminders, weekly summaries) run as cron-triggered API routes authorized by `CRON_SECRET`. The app is live on both the custom domain [www.razeilechem.co.il](https://www.razeilechem.co.il) and [just-an-order-manager.vercel.app](https://just-an-order-manager.vercel.app).

## 📄 License
Shared publicly as a portfolio project.
