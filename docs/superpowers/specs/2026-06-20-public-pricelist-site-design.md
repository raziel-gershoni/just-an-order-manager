# Public Pricelist / Landing Site — Design

**Date:** 2026-06-20
**Status:** Draft (awaiting review)
**Topic:** A public, browser-accessible bakery landing site + pricelist, hosted in the same Next.js app on Vercel, beside the existing Telegram-gated Mini App.

---

## 1. Goal

Give the bakery a public web presence anyone can open in a browser and share — a real landing page with the catalog and prices, an owner-told story, hours/contact, and a clear "order on WhatsApp" path. The existing order-management app stays gated to the Telegram Mini App, untouched.

The public site is **owner-editable end-to-end from the Mini App** (name, story, hours, contact, photos, section order, badges) — no redeploy to change copy or prices.

---

## 2. Locked decisions

| Decision | Choice |
|---|---|
| URL | Public site at the root `/`. Mini App stays at `/miniapp`. Opened inside Telegram, `/` forwards to `/miniapp`. |
| Scope | Full landing page: hero · gallery · pricelist · story · details · CTA. |
| Content management | Fully editable from the Mini App back-office. New `bakery_profile` row per group. |
| Sections | Reorderable + hideable by the owner. A section renders only if **enabled AND non-empty**. |
| Images | Shared **media library** (Vercel Blob). One upload, reused as: a bread thumbnail, the hero image, and/or the gallery. No images yet → all image-dependent UI auto-collapses. |
| Badges | Owner-set, on **both** bread types **and** individual sizes. Value = a **preset** (פופולרי / חדש / מומלץ / לשבת / אזל) **or a custom** short label. |
| Order CTA | **WhatsApp** primary (`wa.me` deep link), **Telegram** secondary (open the bot/Mini App). Ordering still happens in chat. |
| Visual identity | Extend the existing **DOCKET** system. Signature: the pricelist rendered as a perforated kraft docket. |
| Freshness | ISR + on-demand revalidation — the public site updates the moment the owner saves. |
| Multi-tenant | Single group selected by env now, behind `getPublicSite(groupId)`; a `slug` column is added (nullable, unused) so per-bakery URLs are a later, small change. |

Reference mockups (built during design): `/tmp/mockups/public-site.png` (with photos) and `/tmp/mockups/public-site-launch.png` (zero-image launch state).

---

## 3. Architecture

### 3.1 Routing & gating separation

There is **no middleware**; gating today is entirely in the API layer (`withAuth`/`withGroup` require a valid Telegram `initData` header), and `TelegramProvider` lives only in `/miniapp`. So a route outside `/miniapp` is automatically outside the app. The public site needs only its own data path — it never calls a gated API.

Changes:

- **Delete `src/app/page.tsx`** (the `redirect('/miniapp')`).
- **Add route group `src/app/(public)/`** owning `/`:
  - `(public)/layout.tsx` — server component. Exports `generateMetadata` (title/description/OG from the profile) and a **zoom-enabled `viewport`** that overrides the root's locked one. Renders the light public chrome.
  - `(public)/page.tsx` — server component. `const site = await getPublicSite(PUBLIC_SITE_GROUP_ID)`, renders `<SectionRenderer>`, and mounts a tiny `<TelegramRedirect>` client component that calls `router.replace('/miniapp')` when `window.Telegram?.WebApp?.initData` is present.
- **Root `src/app/layout.tsx`** keeps only `<html lang="he" dir="rtl">`, fonts, `<body>`. Two edits:
  - Move the `telegram-web-app.js` `<Script>` **into `src/app/miniapp/layout.tsx`** (a client component; `next/script` works there) so the public page doesn't load it.
  - Set the root's default `metadata.robots` to **noindex**. The Mini App inherits noindex; the public layout overrides with `index: true`. Net: only `/` is indexable.

Per-segment `viewport`/`metadata`/`robots` exports override the parent, so this needs no change to the (client) Mini App layout's behavior.

### 3.2 Public data path

`src/lib/public-site.ts` → `getPublicSite(groupId)` reads the DB directly (no API, no auth) and returns a single view-model:

```
{
  profile: { displayName, tagline, heroHeadline, story, trustItems[],
             whatsappPhone, contactPhone, instagram, address, mapUrl,
             bakeDays, pickupArea, heroImage, isPublished },
  sections: [{ key, visible }],            // owner order
  catalog: [{ id, name, description, badge, image,
              sizes: [{ name, weightGrams, price, badge }] }],
  gallery: [{ url, alt, width, height }],
}
```

- **Effective price** per size = `priceOverride ?? breadSizes.price` (unchanged from the app).
- **Effective badge** (type or size): `badgeType === null` → none; `'custom'` → `badgeLabel` (neutral accent); otherwise a preset label (from i18n) + preset color (from `--status-*`/brand tokens).
- Only `isActive` types and sizes are included.

### 3.3 Caching & revalidation

- `getPublicSite` is wrapped in `unstable_cache(fn, [key], { tags: ['public-site:'+groupId] })`; the public route is otherwise statically rendered (ISR).
- Helper `revalidatePublicSite(groupId)` calls `revalidateTag('public-site:'+groupId)`. It is invoked from every owner mutation that affects the public view: catalog (types/sizes/links/prices/badges/images), `bakery_profile`, and media changes.
- Result: visitors get a cached, fast page; the owner sees edits live within a request.

---

## 4. Data model changes

New/changed tables in `src/db/schema.ts`, one Drizzle migration. (Generation: `drizzle-kit generate` may hit the interactive TTY prompt; fall back to `pnpm db:generate --custom --name=public_site` and hand-write the SQL, as with prior migrations. Migrations auto-run on Vercel build.)

### 4.1 `bakery_profile` (new, 1 row per group)

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `group_id` | int FK → groups, **unique**, not null | |
| `slug` | varchar(80) unique nullable | reserved for future per-bakery URLs; unused now |
| `is_published` | boolean default false | site is dark until the owner publishes |
| `display_name` | varchar(255) nullable | falls back to `groups.name` |
| `tagline` | varchar(255) nullable | |
| `hero_headline` | varchar(255) nullable | optional; default derived from name/tagline |
| `story` | text nullable | |
| `trust_items` | jsonb default `[]` | short strings (e.g. "תסיסה 24 שעות") |
| `hero_image_id` | int FK → media_assets nullable | |
| `logo_image_id` | int FK → media_assets nullable | |
| `whatsapp_phone` | varchar(32) nullable | for `wa.me` |
| `contact_phone` | varchar(32) nullable | |
| `instagram` | varchar(64) nullable | handle |
| `address` | varchar(255) nullable | |
| `map_url` | varchar(1000) nullable | |
| `bake_days` | varchar(64) nullable | e.g. "ה׳–ו׳" |
| `pickup_area` | varchar(120) nullable | |
| `sections` | jsonb | ordered `[{key, visible}]`; default order below |
| `created_at` / `updated_at` | timestamp | |

Default `sections`: `hero` (on) · `gallery` (on, auto-hidden while empty) · `pricelist` (on) · `story` (on) · `details` (on) · `cta` (on).

### 4.2 `media_assets` (new — the shared library)

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `group_id` | int FK → groups, not null | |
| `blob_url` | varchar(1000) not null | public Vercel Blob URL |
| `blob_pathname` | varchar(500) not null | for deletion |
| `alt` | varchar(255) nullable | accessibility / SEO |
| `width` / `height` | int nullable | for layout & OG |
| `show_in_gallery` | boolean default false | drives the gallery section |
| `sort_order` | int default 0 | |
| `created_at` | timestamp | |

Hero, item thumbnail, and gallery all **reference** rows here — a single upload is reusable everywhere.

### 4.3 `bread_types` — add

- `badge_type` varchar(20) nullable — one of `popular | new | recommended | shabbat | sold_out | custom`.
- `badge_label` varchar(40) nullable — used only when `badge_type = 'custom'`.
- `image_id` int FK → media_assets nullable.

### 4.4 `bread_type_sizes` — add

- `badge_type` varchar(20) nullable — same domain as above.
- `badge_label` varchar(40) nullable.

Preset labels live in `src/lib/i18n.ts`; preset colors map to existing tokens (e.g. popular→primary violet, new→success green, shabbat→destructive red, recommended→warning, sold_out→muted). Custom badges use a neutral accent.

---

## 5. Public site composition

A `SectionRenderer` maps the owner's ordered `sections` to server components, skipping any that are hidden or empty. Components live in `src/components/public/` (server-rendered; one small client island for the WhatsApp link if prefilled text needs `encodeURIComponent` — trivial, can stay server).

| Section | Renders | Empty rule |
|---|---|---|
| **Hero** | Seal/eyebrow, headline, lede, WhatsApp + Telegram CTAs, trust line, hero image if set (else stamped seal). | Always shows (core). Image falls back to seal. |
| **Gallery** | Grid of `media_assets where show_in_gallery`. | Hidden if no gallery images. |
| **Pricelist** | The kraft docket: each active type → name + badge + description + (image thumb or `0N` number) + per-size price chips with optional size badges. | Hidden if no active breads. |
| **Story** | Quote-marked story card + signature (display_name). | Hidden if `story` empty. |
| **Details** | Contact ticket: bake days, pickup area, WhatsApp, phone, instagram, address/map. | Rows render only for filled fields; section hidden if all empty. |
| **CTA** | Violet closing band + WhatsApp button. | Hidden if no WhatsApp number. |

**Zero-image launch state** (the real day-one look, `public-site-launch.png`): hero shows the wheat seal, pricelist uses `01–04` numbering instead of thumbnails, gallery is absent. The site looks finished and lights up progressively as photos are added.

---

## 6. Visual design

Extends DOCKET — not a second identity. Tokens, fonts (Space Grotesk display / Assistant Hebrew body / JetBrains Mono data), kraft `#E7DCC4`, card `#F1E9D6`, ink `#241F1A`, stamp-violet `#5B3A8C`, RTL — all reused from `globals.css`.

- **Hero is the thesis:** the bakery's most characteristic object (a loaf photo, or the stamped seal) + a tight type lockup, not a generic stat block.
- **Signature:** the pricelist *is* a perforated kraft order-docket — dashed tear-lines, mono price chips, rubber-stamp badges, ticket `№`. The receipt metaphor the whole product runs on, at marketing scale.
- **Restraint:** one bold element (the docket); story/details/CTA stay quiet. Light-only (no dark back-office theme on the public surface). Responsive to desktop; visible focus; reduced-motion respected.

---

## 7. Mini App back-office editor

New owner/manager-gated area **"האתר שלי"** under settings (`src/app/miniapp/settings/site/page.tsx`), reachable from the control-center tabs. Gating reuses the existing owner/manager check (as used by reminder-templates).

1. **Profile fields** — display name, tagline, story, trust items, bake days, pickup area, WhatsApp, phone, instagram, address/map; a **Publish** toggle.
2. **Sections** — a list the owner can **drag to reorder** and **toggle on/off**; empty sections show a muted "auto-hidden" hint.
3. **Media library** — upload (→ Vercel Blob), delete, set `alt`, mark `show_in_gallery`, reorder; pick the **hero image**.
4. **Badges** — integrated into the existing catalog editor: a badge control **per bread type** and **per size** (preset chips + a custom-text option); and an **image picker** per bread type (choose from the library).

Every save calls the relevant owner-gated API, which calls `revalidatePublicSite(groupId)`.

---

## 8. Image uploads (Vercel Blob)

- Add dependency `@vercel/blob`; env `BLOB_READ_WRITE_TOKEN` (Vercel-provisioned).
- `src/app/api/media/route.ts` — `POST` (owner-gated): accept an image, `put()` to Blob, read dimensions, insert `media_assets`, return it. `GET` lists the group's library. `src/app/api/media/[id]/route.ts` — `PATCH` (alt/gallery/sort), `DELETE` (remove blob + row; null out references).
- Client-side: compress/limit size before upload; accept common image types.
- No public write path exists — uploads are owner-only; the public site only reads.

---

## 9. SEO & metadata

- **Public `/`:** indexable. `generateMetadata` builds title/description from the profile; OpenGraph + Twitter cards. Optional OG image generated with `next/og` `ImageResponse` as a kraft docket card (phase 6).
- **`/miniapp`:** noindex (inherited from the root default).
- `src/app/robots.ts` — allow `/`, disallow `/miniapp`. `src/app/sitemap.ts` — list `/` (and future slugs).
- Public route gets a **zoom-enabled viewport**; the Mini App keeps its locked one.

---

## 10. Order CTA

- **WhatsApp:** `https://wa.me/<whatsapp_phone>?text=<prefilled Hebrew greeting>`. Primary button, hero + closing band + sticky top pill.
- **Telegram:** `https://t.me/<NEXT_PUBLIC_BOT_USERNAME>` (or Mini App deep link) — secondary "order in Telegram".
- Both come from existing config/profile; no new ordering logic on the public side.

---

## 11. Multi-tenant readiness

Single-bakery today, but nothing hard-codes "one bakery" except the **selection**:

- `PUBLIC_SITE_GROUP_ID` env names which group the bare domain shows.
- All reads go through `getPublicSite(groupId)`; all new tables are `group_id`-scoped; `bakery_profile.slug` exists (nullable).
- Future per-bakery URLs = add `app/(public)/[slug]/page.tsx` resolving slug→group and reuse everything. No rewrite.

---

## 12. Config / env

| Var | Purpose | New? |
|---|---|---|
| `PUBLIC_SITE_GROUP_ID` | group shown at `/` | new |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob | new |
| `NEXT_PUBLIC_APP_URL` | absolute URLs, OG, Mini App link | existing |
| `NEXT_PUBLIC_BOT_USERNAME` | Telegram CTA | existing |

`@vercel/blob` added to dependencies. Build unchanged (`tsx scripts/migrate.ts && next build`) — the new migration runs automatically on deploy.

---

## 13. Out of scope (future)

- Online ordering/checkout on the web (ordering stays in chat).
- Per-bakery public URLs / true multi-tenant launch (groundwork only).
- CMS-grade rich text, multi-language (Hebrew/RTL only).
- Inventory/availability per day on the public page.

---

## 14. Implementation phases (detail to follow in the plan)

1. **Foundation** — route split (delete root redirect, add `(public)` layout/page, move TG script, robots/sitemap, metadata/viewport overrides, Telegram forward), `getPublicSite` over the existing catalog with default profile, all six sections with zero-image graceful behavior, WhatsApp/Telegram CTA. A working public site ships here.
2. **Profile** — `bakery_profile` table + migration; `getPublicSite` reads it with sensible fallbacks.
3. **Editor** — "האתר שלי": profile fields, section reorder/toggle, publish; on-demand revalidation wired to saves.
4. **Media** — `media_assets` + Vercel Blob upload API + library UI; wire hero, item thumbnails, gallery.
5. **Badges** — schema on types + sizes; catalog editor controls (per type + per size); render on public rows.
6. **Polish** — OG image, sitemap completeness, desktop responsive pass, a11y, performance.

---

## 15. Open questions

None outstanding — all forks resolved during design (URL, scope, content management, photos, badges).
