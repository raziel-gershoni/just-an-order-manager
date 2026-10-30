# AGENTS.md

Production order-management system for a bakery (https://www.razeilechem.co.il):
a Telegram Mini App + bot for staff and a public SEO storefront for customers.

## Stack
Next.js 16 (App Router, RSC) · React 19 · TypeScript · Neon Postgres · Drizzle ORM ·
Telegram Mini App (@telegram-apps/sdk) + grammy bot · WhatsApp Cloud API · Vercel (Blob, Cron).

## Working in this repo
- Build runs Drizzle migrations before `next build`; see `package.json` scripts for the exact commands.
- Verification gate is TypeScript + build — there is no test runner.
- Gemini is called only through `src/lib/gemini.ts` (model and thinking level are constants there); orders read from a bot message are drafts (`order_drafts`) that the owner saves through the normal form.
- All order pricing must route through the single bulk-pricing engine (one source of truth).
- All DB access goes through `src/db/index.ts`. Its client wrapper (`src/db/write-hook.ts`) marks the kitchen screen's cached copy stale after every successful write; never create another neon/drizzle client in `src`. Limit: Next queues a cache tag once per request, so a write inside `after()` in a request that already wrote before responding is not marked stale again (only `order_drafts` are written there today, which the screen doesn't show; the 2-hour re-read bounds it). Details in `src/lib/cache-tags.ts`.
- Telegram init-data is HMAC-verified; bot authorization mirrors the web layer and enforces
  group membership so order IDs can't cross tenants (multi-tenant by group).
