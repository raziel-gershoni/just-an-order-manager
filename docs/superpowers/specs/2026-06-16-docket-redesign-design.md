# DOCKET Redesign — Design Doc

**Date:** 2026-06-16
**Status:** Locked direction, pending implementation plans (per phase)
**Source:** UI/UX audit (222 findings) + iterative mockup brainstorming

---

## 1. Context & goals

"Just an Orders Manager" is a **personal, single-bakery** management app (the owner's). It runs as a Telegram Mini App but is web-first (works in any browser). Today it wears the Next.js/Vercel default skin (cream + terracotta + Geist) — close to a generic AI-default look — and its admin surface (settings + a 1,090-line catalog page) feels wrong: a thin junk-drawer signposting to deeply-nested config.

**Goals:**
- Give the app a distinctive, intentional identity (DOCKET).
- Rebuild the admin experience as one coherent Control Center.
- Simplify scope: not SaaS (drop multi-tenant), Hebrew/RTL only (drop i18n).
- Fold in the audit's verified fixes (a11y, error handling, RTL correctness) along the way.

**Non-goals (now):** multi-tenant/SaaS, English/multi-language, public marketing surfaces.

---

## 2. Locked decisions

### 2.1 Visual identity — DOCKET
The bakery's paper soul: kraft dockets, **rubber-stamp** status chips (rotated −4°, ink-bled), **perforated** (dashed) row separators, **mono ticket numbers** on the leading edge. Flat solid kraft, small radius (~6px). One identity; the tilt/ink lives on stamps only.

- **Type:** Space Grotesk (Latin: numbers, ticket #s, headers) · **Assistant** (all Hebrew body + headings) · JetBrains Mono (data: prices, grams, %, codes).

### 2.2 Theme model — light front / dark back-office (owner only)
Theme is a **context signal**, not a preference:
- **Light DOCKET** = front-of-house / operational. Home, orders, customers, the production sheet. Seen by **everyone**.
- **Dark DOCKET** (same ticket language in a warm charred-brown skin, with a "מצב ניהול" cue) = the **owner's back-office Control Center**: catalog, baker access, and the owner's own recipe editing. Signals "you're the owner, in the back room — be deliberate."
- **Baker = always light**, including when editing recipes (their admin surface). Bakers never see dark.

Dark palette: `--bg #1E1812 · --surface #2A221A · --surface2 #34291F · --text #EDE3D1 · --muted #A2937D · --line #4A3E30 · --primary #A98BDD · --red #E0685A · --green #93B26F · --amber #E0A24A`.
Light palette (DOCKET): `Kraft #E7DCC4 · Bag Tan #F1E9D6 · Carbon Ink #241F1A · Stamp Violet #5B3A8C · Docket Red #C0392B · Twine Green #5E7148`.

### 2.3 Role model — single bakery, two surfaces
- **Owner (admin)** configures the **business**: bread types, sizes, additions, prices, the additions surcharge, and baker access.
- **Baker** configures the **dough**: recipes are theirs (already true in code — "let bakers manage recipes").
- Both share the light operational screens.
- No "manager" role (SaaS artifact).

### 2.4 Scope reductions
- **Remove i18n entirely** → Hebrew-only, hardcoded `lang="he" dir="rtl"` at the document root. Deletes `i18n.ts`, `lang` state, `useLang`/`useT`, language switcher. Auto-resolves audit bugs: English-leak of hardcoded Hebrew, missing `t()` interpolation, missing-switcher gap.
- **Remove multi-tenant/groups** → one implicit bakery. Drop group switching, group-as-tenant, SaaS invite/onboarding, manager role. The group-level additions surcharge becomes a plain global setting (lives in Catalog). Baker access = a single share link, not a members/invites system.
- **Remove the WhatsApp reminder feature** → delete the per-customer + bulk "remind" buttons (`customers/page.tsx`, `customers/[id]/page.tsx`), the `/api/customers/remind` route, and the `order_reminder` template path. WhatsApp bills *marketing* templates as promotion and we won't pay it. Transactional/utility sends (`order_received`/`order_ready`/`order_cancelled` via `notifyCustomerWhatsApp`) and internal Telegram notifications are unaffected — see §6.

### 2.5 Admin Control Center IA
Collapse `settings` + `catalog` into one back-office (dark, owner-only):
- **Tabs reduced from 3 → ~2:** **קטלוג** (catalog, incl. the surcharge) + a slim **גישה/אופים** (baker access). The old **קבוצה/Group** tab dissolves (no group name, no language, no leave-group).
- **Bread editor = full screen** (replaces the inline expand-within-expand — the key de-nesting move).
- **Recipe editor = prominent** (the densest component; the baker's primary config surface — editable, light for bakers / dark for owner).
- Owner-only gating enforced in UI; confirmations on destructive actions; "pause vs delete" clarified; bread-type reorder exposed (endpoint exists, no UI today).

---

## 3. Design system

- **Tokens:** light + dark sets (above). One source of truth for **status** colors, shared by `border-status-*`, badges, and stamps (today they're defined twice and diverge).
- **Primitives** (consolidate divergent one-offs found in the audit): `Button` (+ `focus-visible` ring), `Badge → Stamp`, `Card → Docket`, `PerforationDivider`, `SegmentedControl` (tabs duplicated on 3 pages), `SearchInput`, `OrderRow`, `PageTitle`.
- **A11y floor (from audit):** visible focus rings; ≥44px tap targets; `prefers-reduced-motion` guard; `html lang/dir = he/rtl`; `aria-label` on icon-only buttons; darken primary so white text clears 4.5:1.

---

## 4. Screen inventory & status

| Screen | Status | Key changes |
|---|---|---|
| Home (light) | mocked ✓ | DOCKET; paid/unpaid, note indicator, pending chip, debt collect |
| Control Center — Catalog (light + dark) | mocked ✓ | tabbed hub, building blocks, breads-as-dockets, recipe-status stamps |
| Bread editor (light + dark) | mocked ✓ | full-screen de-nest; sizes/prices/override; recipe formula; gated delete |
| Baker view (light) | mocked, needs revision | recipes **editable** (not read-only); all-light; production-first |
| Recipe editor (light + dark) | to design | the dense formula component; baker=light, owner=dark |
| Orders list / detail / new | to design | reskin + audit fixes (live total, paid/unpaid, error states, confirmations) |
| Customers list / detail | to design | tap-to-call/WhatsApp, phone search, error states |
| Payments | to design | unify with order settlement, validate amount, show order context |
| Onboarding / join | to design | simplified (no SaaS invites) or removed |

---

## 5. Phased roadmap (each phase = its own implementation plan)

- **Phase 0 — Scope reduction.** Remove i18n (Hebrew-only; fix root `lang/dir`); remove multi-tenant/groups; remove the WhatsApp reminder feature (buttons + `/customers/remind` + `order_reminder` template). Pure refactor, minimal visual change, shrinks the codebase, unblocks everything. Includes any Drizzle migration for dropped group structures.
- **Phase 1 — Design-system foundation.** DOCKET tokens (light + dark) + theme infrastructure (light front / dark owner-back-office; baker always light) + fonts + core primitives + the a11y fixes. App shell + bottom nav adopt DOCKET.
- **Phase 2 — Control Center.** Catalog + access + full-screen Bread editor + Recipe editor; owner gating; confirmations; bread-type reorder. (The original pain point.)
- **Phase 3 — Operational screens.** Home, orders (list/detail/new), customers, payments reskin + their verified bug fixes.
- **Phase 4 — Baker experience.** All-light baker home, production sheet, editable recipes.

Remaining verified bugs from the audit are folded into the phase that owns the relevant screen.

**Traceability:** all 222 audit findings (196 unique after dedup) are mapped to these phases in [`2026-06-16-findings-backlog.md`](./2026-06-16-findings-backlog.md) as a checkable list. **MOOT via scope cut: 32** — 8 (i18n) + 16 (multi-tenant) + 8 (WhatsApp reminder removal, drawn mostly from Phase 3 plus a few from Phases 1/5). Remaining live: Phase 0: 3 · Phase 1: ~54 · Phase 2: 16 · Phase 3: ~67 · Phase 4: 9 · Phase 5: ~15. Severity (full set): 2 critical, 42 high, 90 medium, 62 low.

---

## 6. Open questions / risks

- **Telegram theme params:** the app may read Telegram's `colorScheme`/`themeParams`; our context-based theme model must override it deterministically.
- **Data migration:** dropping the groups layer needs a Drizzle migration that preserves existing bread/size/addition/order rows under the single implicit bakery.
- **Recipe reference-weight UX:** clarify "finished loaf weight" vs dough total in the editor (audit flagged it as confusing).
- **Baker access mechanism:** confirm the simple share-link approach is sufficient vs. anything more.
- **Transactional WhatsApp:** new-order / ready / cancelled still send *utility* templates to customers via `notifyCustomerWhatsApp`. Usually not billed as promotion — **keep by default**; only gate behind a flag (or remove) if the WhatsApp bill shows they're charged. (The *marketing* reminder template is already removed per §2.4.)

---

## 7. Recommended first step

**Phase 0 (scope reduction)** — lowest risk, no design dependencies, removes the i18n bugs immediately, and makes Phases 1–4 simpler. Then Phase 1 (foundation) so the whole app can wear DOCKET.
