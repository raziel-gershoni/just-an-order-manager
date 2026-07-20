# AGENTS.md

Production order-management system for a bakery (https://www.razeilechem.co.il):
a Telegram Mini App + bot for staff and a public SEO storefront for customers.

## Stack
Next.js 16 (App Router, RSC) · React 19 · TypeScript · Neon Postgres · Drizzle ORM ·
Telegram Mini App (@telegram-apps/sdk) + grammy bot · WhatsApp Cloud API · Vercel (Blob, Cron).

## Working in this repo
- Build runs Drizzle migrations before `next build`; see `package.json` scripts for the exact commands.
- Verification gate is TypeScript + build — there is no test runner.
- All order pricing must route through the single bulk-pricing engine (one source of truth).
- Telegram init-data is HMAC-verified; bot authorization mirrors the web layer and enforces
  group membership so order IDs can't cross tenants (multi-tenant by group).
