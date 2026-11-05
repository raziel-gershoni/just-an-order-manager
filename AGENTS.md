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
- Vercel runs in UTC but the bakery is on Israel time, so server code takes the bakery's calendar day only from `src/lib/date-utils.ts` (`todayStr`, `israelDateStr`, `addDaysStr`) and, in SQL, from `israelDay()` in `src/db/israel-day.ts` — never from `new Date()`/`format(new Date())` or `created_at::date` (both are the UTC day, wrong for the first 2-3 hours after Israeli midnight).
- בהקדם (open, undated) orders follow one per-bakery switch, `groups.asap_in_today`: their own group just before today, or part of today. Server code takes "today" and "בהקדם" only from `src/lib/asap.ts` (`todayCondition`, `openUndated`); mini-app lists group through `groupByDeliveryDate` (`src/lib/order-grouping.ts`) with the `today`/`asapInToday` their API returns. Telegram day texts live in `src/lib/day-digest.ts`.
- Postgres returns rows in no fixed order without `ORDER BY`. Any query whose rows reach a user (a list, a message, a sheet, an export) or that keeps "the first" row needs an explicit `ORDER BY`, with a tie-break where ties would show. Order lines by `order_items.id`, additions and bread types by `sort_order`. `groupByDeliveryDate` sorts the date groups itself; rows inside a day keep the query's order.
- Every caught error is logged (`console.error`/`warn` with a `[tag]`; a toast's text through `friendlyError`, which logs). A mini-app screen, sheet or picker whose data failed to load shows `LoadError` (`src/components/ui/LoadError.tsx`) instead of its content, never an empty or default-valued form that could be saved over data that was never read; its failed flag clears only when a load succeeds. A 404 keeps its own "not found"/"invalid" text.
- The kitchen screen (`/kitchen`) is view-only and paired by cookie (`src/lib/kitchen-screen.ts`). It renders `unstable_cache` copies tagged `kitchen` (`src/lib/kitchen-sheet.ts`), built with the print view's own `buildPrintSheet`, and polls `/api/kitchen/state`, which sends data only when the copy changed. Past days are not on it. Pinned at the bottom it shows counts only, never a list: orders overdue (a past day, still open) and orders awaiting approval. The morning Telegram nudges list the same orders; both take the rules from `src/lib/order-attention.ts`.
- WhatsApp inbound: Meta's per-phone-number webhook override points this number at `/api/whatsapp/webhook`; the app-level webhook of the shared Meta app belongs to another project, so never change it. The route verifies `X-Hub-Signature-256` with that app's secret (`WHATSAPP_APP_SECRET`; the GET handshake uses `WHATSAPP_VERIFY_TOKEN`), parses into plain items (`src/lib/whatsapp-inbound.ts`) and hands each to one handler (`src/lib/whatsapp-inbound-handler.ts`), the seam for the later interactive ordering bot. Today it forwards to the owner and managers on Telegram. Each wamid is claimed in `whatsapp_inbound` before the forward; a failed forward, or a repeat delivery while one is still in flight, answers 500 so Meta's retries bring it back.
- Telegram init-data is HMAC-verified; bot authorization mirrors the web layer and enforces
  group membership so order IDs can't cross tenants (multi-tenant by group).
