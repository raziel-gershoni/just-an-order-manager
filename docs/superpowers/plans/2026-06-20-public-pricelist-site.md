# Public Pricelist / Landing Site — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax. This repo has **no test runner** — the verification gate for every task is `npx tsc --noEmit` (and `next build` / a headless-Chrome screenshot where noted), not unit tests.

**Goal:** Ship a public, browser-accessible bakery landing site + pricelist at `/`, owner-editable from the Mini App, beside the unchanged Telegram-gated app at `/miniapp`.

**Architecture:** A `(public)` route group owns `/`, server-rendered from a direct DB read (`getPublicSite`) cached with ISR + on-demand revalidation. New `bakery_profile` and `media_assets` tables plus badge/image columns drive an owner-edited landing page composed of toggleable, reorderable sections. Images go to Vercel Blob.

**Tech Stack:** Next.js 16.2 App Router (React 19), Tailwind v4 (DOCKET tokens), drizzle-orm + Neon, `@vercel/blob`, lucide-react, sonner.

## Global Constraints

- Hebrew + RTL only; no i18n framework — copy lives in `src/lib/i18n.ts`.
- Single bakery, multi-tenant-ready: every new table is `group_id`-scoped; the public site's group is chosen by `PUBLIC_SITE_GROUP_ID`; reads go through `getPublicSite(groupId)`.
- DOCKET design tokens only (kraft `#E7DCC4`, card `#F1E9D6`, ink `#241F1A`, primary `#5B3A8C`); fonts `--font-display`/`--font-sans`/`--font-mono`; light-only on the public surface.
- The Mini App at `/miniapp` and all `/api/*` auth must remain functionally unchanged.
- Effective price = `priceOverride ?? breadSizes.price`. Effective badge: `badge_type` null → none; `'custom'` → `badge_label`; else preset (label from i18n, color from token).
- Owner/manager gate on all new write APIs (reuse the role check used by `reminder-templates`).
- Migrations auto-run on Vercel build; generate with the `--custom` fallback if drizzle-kit hits the interactive TTY, then hand-write SQL.
- Verification gate: `npx tsc --noEmit` passes after every task; `next build` passes at phase ends; commit after each task.

---

## File Structure

**Create:**
- `src/lib/badges.ts` — preset badge registry (key → i18n label key + color token) + `resolveBadge()`.
- `src/lib/public-site.ts` — `getPublicSite`, view-model types, `revalidatePublicSite`, `buildWhatsAppLink`, `buildTelegramLink`, default sections.
- `src/lib/media.ts` — Vercel Blob `uploadImage`/`deleteImage` wrappers.
- `src/app/(public)/layout.tsx` — public layout: `generateMetadata`, zoomable `viewport`, light chrome.
- `src/app/(public)/page.tsx` — landing page.
- `src/app/(public)/opengraph-image.tsx` — OG card (phase E).
- `src/app/robots.ts`, `src/app/sitemap.ts`.
- `src/components/public/SectionRenderer.tsx`, `HeroSection.tsx`, `GallerySection.tsx`, `PricelistSection.tsx`, `StorySection.tsx`, `DetailsSection.tsx`, `CtaSection.tsx`, `PublicBadge.tsx`, `WhatsAppButton.tsx`, `TelegramRedirect.tsx`.
- `src/app/api/media/route.ts`, `src/app/api/media/[id]/route.ts`.
- `src/app/api/site-profile/route.ts`.
- `src/app/miniapp/settings/site/page.tsx` — "האתר שלי" editor.
- `src/components/site-editor/SectionManager.tsx`, `MediaLibrary.tsx`, `BadgePicker.tsx`, `ImagePicker.tsx` (editor pieces).
- `drizzle/00NN_public_site.sql` + snapshot.

**Modify:**
- `src/db/schema.ts` — add `bakeryProfile`, `mediaAssets`; add columns to `breadTypes`, `breadTypeSizes`.
- `src/app/layout.tsx` — default `robots: noindex`; move Telegram `<Script>` out (to miniapp).
- `src/app/miniapp/layout.tsx` — render Telegram `<Script strategy="afterInteractive">`.
- `src/lib/i18n.ts` — public-site + badge + editor copy.
- `src/components/ui/ControlCenterTabs.tsx` — add "האתר שלי" entry.
- catalog editor (`src/app/miniapp/settings/catalog/page.tsx`) — badge + image controls.
- catalog/profile/media mutation handlers — call `revalidatePublicSite`.
- `.env.example` — `PUBLIC_SITE_GROUP_ID`, `BLOB_READ_WRITE_TOKEN`.
- `package.json` — add `@vercel/blob`.

---

## Phase A — Foundation: schema + routing + public shell

### Task 1: Schema + migration

**Files:** Modify `src/db/schema.ts`; Create `drizzle/00NN_public_site.sql`.

- [ ] Add `bakeryProfile` table: `id` serial PK; `groupId` int FK→groups unique notNull; `slug` varchar(80) unique nullable; `isPublished` bool default false; `displayName`/`tagline`/`heroHeadline` varchar nullable; `story` text nullable; `trustItems` jsonb default `[]`; `heroImageId`/`logoImageId` int nullable; `whatsappPhone`/`contactPhone` varchar(32); `instagram` varchar(64); `address` varchar(255); `mapUrl` varchar(1000); `bakeDays` varchar(64); `pickupArea` varchar(120); `sections` jsonb; `createdAt`/`updatedAt` timestamps.
- [ ] Add `mediaAssets` table: `id` serial PK; `groupId` int FK→groups notNull; `blobUrl` varchar(1000) notNull; `blobPathname` varchar(500) notNull; `alt` varchar(255); `width`/`height` int; `showInGallery` bool default false; `sortOrder` int default 0; `createdAt`.
- [ ] Add to `breadTypes`: `badgeType` varchar(20); `badgeLabel` varchar(40); `imageId` int (FK→mediaAssets, set null on delete).
- [ ] Add to `breadTypeSizes`: `badgeType` varchar(20); `badgeLabel` varchar(40).
- [ ] Generate the migration (`--custom` fallback if needed) and hand-write the SQL: 2× CREATE TABLE, ALTER bread_types ADD 3 cols, ALTER bread_type_sizes ADD 2 cols, FKs.
- [ ] **Verify:** `npx tsc --noEmit` passes. **Commit:** `feat(db): bakery_profile + media_assets + badge/image columns`.

### Task 2: Badge registry + i18n

**Files:** Create `src/lib/badges.ts`; Modify `src/lib/i18n.ts`.

**Produces:** `BADGE_PRESETS: Record<BadgePreset, {labelKey, colorVar}>`; `resolveBadge(type, label, lang): {text, colorVar} | null`.

- [ ] `BadgePreset = 'popular'|'new'|'recommended'|'shabbat'|'sold_out'`. Map → i18n keys (`badge.popular` = "פופולרי", etc.) and color vars (popular→`--primary`, new→`--success`, recommended→`--warning`, shabbat→`--destructive`, sold_out→`--muted-foreground`).
- [ ] `resolveBadge`: `type==null` → null; `type==='custom'` → `{text: label, colorVar: '--primary'}`; else `{text: t(preset.labelKey), colorVar: preset.colorVar}`.
- [ ] Add badge labels + public-site copy keys to i18n.
- [ ] **Verify:** `npx tsc --noEmit`. **Commit:** `feat(badges): preset badge registry + i18n`.

### Task 3: Public data layer

**Files:** Create `src/lib/public-site.ts`.

**Produces:**
- `PublicSite = { profile: PublicProfile; sections: SectionConfig[]; catalog: PublicBread[]; gallery: PublicImage[] }`.
- `getPublicSite(groupId: number): Promise<PublicSite | null>` — direct drizzle reads; wraps the assembly in `unstable_cache(..., ['public-site', String(groupId)], { tags: [siteTag(groupId)] })`; returns `null` if no group or `isPublished` false.
- `siteTag(groupId)` = `` `public-site:${groupId}` ``; `revalidatePublicSite(groupId)` → `revalidateTag(siteTag(groupId))`.
- `buildWhatsAppLink(phone, text)`, `buildTelegramLink(botUsername)`.
- `DEFAULT_SECTIONS: SectionConfig[]` (hero, gallery, pricelist, story, details, cta — all visible).

- [ ] Implement reads: profile (fallback to `groups.name` for displayName; `DEFAULT_SECTIONS` when null); active bread types ordered by sortOrder, each with active sizes (effective price + size badge) and resolved type badge + image URL; gallery = mediaAssets where `showInGallery` ordered by sortOrder.
- [ ] **Verify:** `npx tsc --noEmit`. **Commit:** `feat(public-site): getPublicSite data layer + revalidation`.

### Task 4: Routing split

**Files:** Delete `src/app/page.tsx`; Modify `src/app/layout.tsx`, `src/app/miniapp/layout.tsx`; Create `src/app/(public)/layout.tsx`, `src/app/(public)/page.tsx`, `src/components/public/TelegramRedirect.tsx`, `src/app/robots.ts`, `src/app/sitemap.ts`.

- [ ] Root layout: drop the Telegram `<Script>`; set `metadata.robots = { index: false, follow: false }` as the default; keep fonts + locked viewport.
- [ ] Miniapp layout: render `<Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />` (TelegramProvider already polls up to 2s, so this is safe — verify by reading the provider).
- [ ] `(public)/layout.tsx`: server component; `generateMetadata` builds title/description/OpenGraph from `getPublicSite(PUBLIC_SITE_GROUP_ID)` with `robots: { index: true }`; export zoomable `viewport`; render light wrapper.
- [ ] `(public)/page.tsx`: `const site = await getPublicSite(...)`; if null render a minimal "coming soon" kraft card; else `<SectionRenderer site={site} />` + `<TelegramRedirect />`.
- [ ] `TelegramRedirect`: `'use client'`; on mount, if `window.Telegram?.WebApp?.initData` → `router.replace('/miniapp')`.
- [ ] `robots.ts`: allow `/`, disallow `/miniapp`; `sitemap.ts`: `[{ url: base }]`.
- [ ] **Verify:** `next build` succeeds; route map shows `/` and `/miniapp`. **Commit:** `feat(public): route split — public / beside gated /miniapp`.

### Task 5: Section components

**Files:** Create `src/components/public/{SectionRenderer,HeroSection,PricelistSection,StorySection,DetailsSection,CtaSection,GallerySection,PublicBadge,WhatsAppButton}.tsx`.

- [ ] Port the approved mockup (`/tmp/mockups/public-site-launch.html` + `public-site.html`) into server components driven by `PublicSite`. `SectionRenderer` maps `sections` (ordered, visible) → component, skipping empty (gallery w/o images, story w/o text, pricelist w/o breads, cta w/o whatsapp, details w/o fields).
- [ ] Hero: image if `profile.heroImage` else stamped seal. Pricelist: docket; per row image thumb or `0N`; type badge via `PublicBadge`; size chips with optional size badge. `WhatsAppButton` builds the `wa.me` link.
- [ ] **Verify:** `npx tsc --noEmit`; render `(public)/page.tsx` markup via a screenshot harness (mock `PublicSite`) — matches the approved mockup. **Commit:** `feat(public): landing sections (hero, docket pricelist, story, details, cta, gallery)`.
- [ ] **Phase A gate:** `next build`; screenshot of the zero-data + seeded states; commit any fixes.

---

## Phase B — Profile API + "האתר שלי" editor

### Task 6: Profile API

**Files:** Create `src/app/api/site-profile/route.ts`.

**Produces:** `GET` (owner-gated) → profile (creating a default row if absent); `PATCH` → zod-validated partial update of all profile fields incl. `sections` and `isPublished`; both call `revalidatePublicSite(groupId)` on write.

- [ ] Implement with `withGroup` + owner/manager check; zod schema for the editable fields; upsert semantics.
- [ ] **Verify:** `npx tsc --noEmit`. **Commit:** `feat(api): site-profile GET/PATCH (owner-gated)`.

### Task 7: Editor shell + profile fields

**Files:** Create `src/app/miniapp/settings/site/page.tsx`; Modify `src/components/ui/ControlCenterTabs.tsx`, `src/lib/i18n.ts`.

- [ ] "האתר שלי" page (back-office dark theme like other settings): load profile, edit text fields (displayName, tagline, story, trustItems, bakeDays, pickupArea, whatsappPhone, contactPhone, instagram, address, mapUrl), a **Publish** switch; save → PATCH; sonner toasts.
- [ ] Add the tab to ControlCenterTabs.
- [ ] **Verify:** `npx tsc --noEmit`; screenshot the editor. **Commit:** `feat(site-editor): profile fields + publish toggle`.

### Task 8: Section manager (reorder + toggle)

**Files:** Create `src/components/site-editor/SectionManager.tsx`; Modify the site editor page.

- [ ] Ordered list of the 6 sections with up/down reorder (no external dnd lib — buttons; keeps deps light) and a visibility toggle each; persists to `profile.sections` via PATCH. Show a muted "auto-hidden — no content" hint where applicable.
- [ ] **Verify:** `npx tsc --noEmit`; screenshot. **Commit:** `feat(site-editor): reorder + hide sections`.
- [ ] **Phase B gate:** `next build`; commit fixes.

---

## Phase C — Media library (Vercel Blob)

### Task 9: Blob dependency + helpers

**Files:** `package.json` (add `@vercel/blob`); Create `src/lib/media.ts`; Modify `.env.example`.

- [ ] `pnpm add @vercel/blob`. `uploadImage(file, groupId)` → `put()` (random suffix), return `{url, pathname, width, height}`; `deleteImage(pathname)` → `del()`. Add `BLOB_READ_WRITE_TOKEN`, `PUBLIC_SITE_GROUP_ID` to `.env.example`.
- [ ] **Verify:** `npx tsc --noEmit`. **Commit:** `feat(media): vercel blob helpers + env`.

### Task 10: Media API

**Files:** Create `src/app/api/media/route.ts`, `src/app/api/media/[id]/route.ts`.

- [ ] `POST /api/media` (owner-gated, multipart) → upload + insert `mediaAssets`. `GET` → list group's library. `PATCH /api/media/[id]` → alt/showInGallery/sortOrder. `DELETE` → del blob + row + null references. All writes call `revalidatePublicSite`.
- [ ] **Verify:** `npx tsc --noEmit`. **Commit:** `feat(api): media library CRUD`.

### Task 11: Media library UI + hero pick

**Files:** Create `src/components/site-editor/{MediaLibrary,ImagePicker}.tsx`; Modify the site editor page.

- [ ] Library grid: upload, delete, edit alt, toggle "in gallery", pick hero image (sets `profile.heroImageId`). `ImagePicker` reused for hero + per-bread image.
- [ ] **Verify:** `npx tsc --noEmit`; screenshot. **Commit:** `feat(site-editor): media library + hero image`.
- [ ] **Phase C gate:** `next build`; verify hero/gallery/item images flow into `getPublicSite`; screenshot the photo-on public state.

---

## Phase D — Badges in the catalog editor

### Task 12: Per-type badge + image

**Files:** Create `src/components/site-editor/BadgePicker.tsx`; Modify `src/app/miniapp/settings/catalog/page.tsx` + its bread-type PATCH handler.

- [ ] `BadgePicker`: preset chips (from `BADGE_PRESETS`) + a "custom" text option + clear; emits `{badgeType, badgeLabel}`. Add to the bread-type editor row, plus an `ImagePicker` for the type thumbnail. Persist via the existing bread-type update path; call `revalidatePublicSite`.
- [ ] **Verify:** `npx tsc --noEmit`; screenshot. **Commit:** `feat(catalog): per-type badge + image`.

### Task 13: Per-size badge

**Files:** Modify the catalog editor + the bread-type-size link handler (`.../bread-types/[typeId]/sizes`).

- [ ] Add a compact `BadgePicker` per size link; persist `badgeType`/`badgeLabel` on `bread_type_sizes`; revalidate.
- [ ] **Verify:** `npx tsc --noEmit`; screenshot showing a size badge on the public docket. **Commit:** `feat(catalog): per-size badge`.
- [ ] **Phase D gate:** `next build`.

---

## Phase E — Polish

### Task 14: OG image + SEO finalize

**Files:** Create `src/app/(public)/opengraph-image.tsx`; verify `robots.ts`/`sitemap.ts`.

- [ ] `next/og` `ImageResponse`: a kraft docket OG card (bakery name + tagline + № motif) from the profile. Confirm metadata, OG tags, robots (allow `/`, block `/miniapp`), sitemap.
- [ ] **Verify:** `next build`; fetch `/opengraph-image` renders. **Commit:** `feat(public): OG image + SEO`.

### Task 15: Responsive + a11y + seed pass

**Files:** Across public components; optional `scripts/seed-public-site.ts`.

- [ ] Desktop breakpoint pass (center column, larger hero), focus-visible, reduced-motion, alt text wired from `mediaAssets.alt`. Sensible default copy seeded so a fresh bakery's site is presentable before editing.
- [ ] **Verify:** `next build`; desktop + mobile screenshots. **Commit:** `feat(public): responsive, a11y, default copy`.

---

## Final

- [ ] `npx tsc --noEmit` clean; `next build` clean.
- [ ] Push to `main`; ping the user.

---

## Self-Review

**Spec coverage:** §3.1 routing → Task 4; §3.2 data → Task 3; §3.3 caching → Tasks 3/6/10/12/13; §4.1 profile → Task 1; §4.2 media → Tasks 1/10; §4.3–4.4 badges → Tasks 1/12/13; §5 sections → Task 5; §6 visual → Task 5; §7 editor → Tasks 7/8/11/12/13; §8 uploads → Tasks 9/10; §9 SEO → Tasks 4/14; §10 CTA → Tasks 3/5; §11 multi-tenant → Tasks 1/3; §12 config → Tasks 1/9. All covered.

**Placeholder scan:** none — every task names exact files, columns, and signatures.

**Type consistency:** `getPublicSite`/`PublicSite`/`siteTag`/`revalidatePublicSite`/`resolveBadge`/`BADGE_PRESETS`/`BadgePreset` used consistently across Tasks 2–14; `{badgeType, badgeLabel}` shape shared by schema, API, and `BadgePicker`.
