# DOCKET Redesign — Findings Backlog

**Date:** 2026-06-16  
**Source:** UI/UX audit (222 raw findings) → deduplicated & phase-mapped against the [DOCKET redesign design doc](2026-06-16-docket-redesign-design.md).  
**Purpose:** Coverage checklist so nothing from the audit is lost. Every unique finding is assigned to exactly one phase, or marked MOOT (resolved by the i18n / multi-tenant scope cut).

After merging near-identical findings reported by multiple audit agents, **196 unique items** remain (from 222 raw).

## Coverage summary

### By phase

| Phase | Unique items |
|---|---|
| Phase 0 — Scope reduction (remove i18n + multi-tenant/groups) | 3 |
| Phase 1 — Design-system foundation & accessibility | 55 |
| Phase 2 — Control Center (catalog / recipe / config) | 16 |
| Phase 3 — Operational screens (home / orders / customers / payments) | 72 |
| Phase 4 — Baker experience | 9 |
| Phase 5 — Polish backlog (low-severity, no natural screen owner) | 17 |
| **MOOT** (resolved by scope cut) | 24 |
| **Total unique** | **196** |

### By severity (all unique items)

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 42 |
| Medium | 90 |
| Low | 62 |

### MOOT breakdown

- Resolved by **removing i18n** (Hebrew-only): 8
- Resolved by **removing multi-tenant / groups**: 16
- **Total MOOT:** 24

> Legend: `[SEV·CAT]` — SEV ∈ CRIT/HIGH/MED/LOW; CAT is the audit category (A11Y, RTL, INT, DATA, IA, VIS, CONS, COPY, LAYOUT, PERF, TYPE, MOTION). `(flagged N×)` = merged from N near-identical audit findings.

---

## Phase 0 — Scope reduction (remove i18n + multi-tenant/groups)

_Pure refactor. These are real work items that survive the scope cut (the rest are MOOT below). Mostly Hebrew-only string normalization + the root `<html lang/dir>` fix._

**3 items.**

- [ ] [CRIT·A11Y] Root <html> is locked to lang="en" and dir is never set on it, while the app is Hebrew-first (flagged 3×) — `src/app/layout.tsx:26-28; src/app/miniapp/layout.tsx:61,67-70` — Drive lang and dir from the resolved language.
- [ ] [HIGH·RTL] Hebrew strings store the punctuation visually flipped — fragile and breaks on edit — `src/lib/i18n.ts:33-36, 61, 75-76, 78, 104, 132, 211, 215` — Store the punctuation in correct logical order (e.g.
- [ ] [HIGH·RTL] formatItemLine hardcodes Hebrew 'עם' (with) in customer-facing output regardless of language — `src/lib/order-display.ts:6-17, 24-35` — Pass lang into both formatters and pull the connector from i18n (add 'item.with': {en:'with', he:'עם'}), or accept the connector string as a param.

---

## Phase 1 — Design-system foundation & accessibility

_DOCKET tokens (light + dark), theme infrastructure, fonts, shared primitives (Button/Card→Docket/Badge→Stamp/SegmentedControl/SearchInput/OrderRow/Avatar/PageTitle), the a11y floor (focus rings, ≥44px targets, aria-labels, contrast, reduced-motion, status tokens), single live-toast surface, and the shared money/phone bidi formatter._

**55 items.**

- [ ] [CRIT·A11Y] No visible focus indicator anywhere — keyboard and switch users cannot see where they are (flagged 3×) — `src/components/ui/Button.tsx:43-49; src/components/ui/BottomNav.tsx:35-40; src/components/ui/PageHeader.tsx:14-17; src/components/ui/Input.tsx:21-24` — Add a shared focus-visible treatment.
- [ ] [HIGH·A11Y] Primary buttons and primary-colored text/links fall below 4.5:1 contrast — `src/app/globals.css:43-44,52-53; src/components/ui/Button.tsx:16-17,27` — Darken the primary token (e.g.
- [ ] [HIGH·A11Y] Many tap targets are well below the 44px minimum on phone (flagged 2×) — `src/components/ui/Button.tsx:25-30; src/app/miniapp/settings/catalog/page.tsx:546-564; src/app/miniapp/orders/[id]/page.tsx:350-356` — Raise the icon size variant to h-11 w-11 (44px) for primary touch contexts, or wrap small glyphs in a 44px tappable area using padding while keeping the visu….
- [ ] [HIGH·MOTION] No prefers-reduced-motion support — every page animates unconditionally (flagged 3×) — `src/app/globals.css:71-129` — Add a global guard in globals.css: `@media (prefers-reduced-motion: reduce) { .animate-fade-in, .animate-slide-down, .animate-expand, .animate-reorder, .anim….
- [ ] [HIGH·RTL] Currency amounts (₪) have no bidi isolation inside RTL text — sign lands on the wrong side (flagged 3×) — `src/app/miniapp/page.tsx:258; src/app/miniapp/orders/[id]/page.tsx:303-552; src/app/miniapp/payments/page.tsx:189; src/app/miniapp/customers/[id]/page.tsx:200,414` — Create one money formatter and reuse it everywhere instead of inline template strings.
- [ ] [HIGH·RTL] Phone numbers rendered without dir/isolation — separators and order can corrupt in RTL (flagged 2×) — `src/app/miniapp/customers/[id]/page.tsx:262-297; src/components/ui/Input.tsx:18-27` — Force phone display and entry to LTR with isolation: add dir="ltr" (and optionally text-align start) to the phone <span> and to the <Input type="tel"> for ph….
- [ ] [HIGH·INT] Double toast system: ToastContainer is dead code while showToast fires twice (flagged 5×) — `src/components/ui/Toast.tsx:6-47 (+ src/app/miniapp/layout.tsx:19-30)` — Pick one.
- [ ] [HIGH·A11Y] Icon-only buttons render with no accessible name (flagged 2×) — `src/components/ui/Button.tsx:29 (consumed e.g. src/app/miniapp/customers/[id]/page.tsx:269-303)` — Either require a label for icon buttons by typing them (a discriminated prop e.g.
- [ ] [MED·A11Y] Bread-type <select> and customer-search <input> have no associated label — `src/app/miniapp/orders/new/page.tsx:259-264,313-328; src/app/miniapp/settings/catalog/page.tsx:695-707` — Give each select an aria-label like t('form.bread_type') (optionally including the line number, e.g.
- [ ] [MED·A11Y] Form validation gives no accessible feedback — disabled submit with no reason, no error text — `src/app/miniapp/orders/new/page.tsx:525-533,354-357; src/app/miniapp/payments/page.tsx:181-190` — When submit is blocked, render a short inline explanation with id and reference it via aria-describedby on the button (e.g.
- [ ] [MED·A11Y] Inline drawers and payment flow open without focus management or announcement — `src/app/miniapp/orders/[id]/page.tsx:359-378,430-454; src/app/miniapp/settings/catalog/page.tsx:611-660` — When opening an inline editor, move focus to its first input (ref + .focus() in the click handler, as the phone fields already do).
- [ ] [MED·A11Y] Status communicated by color/border alone — Badge, status flow, and balance lack non-color cues for SR and color-blind users — `src/components/orders/StatusFlow.tsx:28-78; src/components/ui/Badge.tsx:5-13; src/app/globals.css:131-138` — Give StatusFlow an accessible summary: wrap it with role='img' aria-label or an sr-only line like `${t('status.current')}: ${labels[status]}` and mark step d….
- [ ] [MED·CONS] Page-level container padding scale drifts (p-5 / p-6) and space-y is inconsistent (4 / 5 / 6) — `src/app/miniapp/page.tsx:94,121; src/app/miniapp/orders/page.tsx:67; src/app/miniapp/settings/page.tsx:81; src/app/miniapp/baker/page.tsx:97; src/app/miniapp/payments/page.tsx:102` — Introduce a single page-shell primitive (e.g.
- [ ] [MED·TYPE] Top-level page titles use two different sizes (text-xl vs text-2xl) and a third style in PageHeader (text-lg) — `src/app/miniapp/page.tsx:99; src/app/miniapp/orders/page.tsx:69; src/components/ui/PageHeader.tsx:21` — Define a single page-title scale.
- [ ] [MED·CONS] Top-level tab pages each re-implement their own header row instead of sharing a primitive — `src/app/miniapp/orders/page.tsx:68-76; src/app/miniapp/customers/page.tsx:92-100; src/app/miniapp/baker/page.tsx:98-101; src/app/miniapp/settings/page.tsx:82` — Extract a `TabHeader` (or extend PageHeader with a `noBack`/`leadingIcon`/`action` prop) that standardizes: title typography, optional leading icon slot (Bak….
- [ ] [MED·CONS] Search input is hand-built inline twice, bypassing the Input primitive (divergent search field) — `src/app/miniapp/customers/page.tsx:121-128; src/app/miniapp/orders/new/page.tsx:257-264; src/components/ui/Input.tsx:18-26` — Add an optional `icon`/`leading` prop (or a dedicated `SearchInput`) to the Input primitive that renders the lucide icon with the correct `ps-9` offset, then….
- [ ] [MED·CONS] Segmented toggle (tabs) duplicated across 3 pages with divergent active-state colors — `src/app/miniapp/orders/page.tsx:79-94; src/app/miniapp/payments/page.tsx:104-127; src/app/miniapp/settings/page.tsx:182-197` — Extract a `SegmentedControl`/`Tabs` primitive taking `options` and an optional `tone` (neutral vs colored).
- [ ] [MED·CONS] Status-colored order rows are styled two different ways (Card with ps-5 border vs bare div), and ps offset varies — `src/app/miniapp/orders/page.tsx:121-145; src/app/miniapp/page.tsx:181-197; src/app/miniapp/customers/[id]/page.tsx:378-391` — Create an `OrderRow` component that takes the order and renders the status border, customer name + recurring icon, itemsSummary, Badge, and trailing chevron/….
- [x] [MED·CONS] WhatsApp/reminder action rendered as two unrelated bespoke buttons (and neither uses Button) — `src/app/miniapp/customers/page.tsx:169-176; src/app/miniapp/customers/[id]/page.tsx:227-248` — Define one 'WhatsApp/positive' action treatment — ideally a Button variant (e.g. — MOOT (reminder feature removed)
- [ ] [MED·CONS] Semantic status colors are defined twice (globals border-status vs Badge Tailwind palette) and never share a source (flagged 3×) — `src/app/globals.css:131-138; src/components/ui/Badge.tsx:5-13; src/app/miniapp/orders/[id]/page.tsx:458,483` — Introduce design tokens for the status set (and for success/warning) in globals.css, then derive both the `border-status-*` classes and the Badge background/….
- [ ] [MED·COPY] Status, delivery, and balance labels are inconsistent about gendered/Hebrew register — `src/lib/i18n.ts:36, 106, 115, 70, 140, 143, 240-243` — Pick one register and apply it everywhere.
- [ ] [MED·DATA] slice(2) on formatItemLine to strip quantity is a brittle string hack — `src/lib/order-display.ts:6-17` — Add a dedicated formatter that returns the name-only portion (e.g.
- [ ] [MED·RTL] Additions join with ', ' produces incorrect ordering/spacing inside RTL Hebrew lines — `src/lib/order-display.ts:13-15, 33` — Use a Hebrew list separator and isolate each addition: join with '، ' or '⁨name⁩' wrapped, or build the line via an Intl.ListFormat('he') with the connector….
- [ ] [MED·PERF] No viewport / theme-color / color-scheme metadata exported — `src/app/layout.tsx:16-19` — Add `export const viewport: Viewport = { themeColor: '#...terracotta...', colorScheme: 'light', viewportFit: 'cover', width: 'device-width', initialScale: 1….
- [ ] [MED·VIS] Single hardcoded light theme — no dark tokens, yet dark: classes are already used — `src/app/globals.css:33-61; src/app/miniapp/baker/page.tsx:220-224` — Add a dark token set keyed to either `@media (prefers-color-scheme: dark)` on :root or a `.dark` class toggled from Telegram's `colorScheme`/`themeParams`.
- [ ] [MED·TYPE] Geist Sans/Mono is the literal Next.js default — undercuts the artisan-bakery brand and lacks Hebrew — `src/app/layout.tsx:6-14; src/app/globals.css:24-25` — Choose a typeface pairing with real Hebrew coverage and bakery character: e.g.
- [ ] [MED·LAYOUT] animate-expand caps content at max-height:500px — taller cards get clipped (flagged 2×) — `src/app/globals.css:89-116; src/app/miniapp/settings/catalog/page.tsx:513,612,726,798,886` — Either raise the cap to a safely-large value AND drop `overflow: hidden` once the animation ends (e.g.
- [ ] [MED·MOTION] Navigation after submit has no transition feedback — taps feel laggy on route change — `src/app/miniapp/orders/new/page.tsx:178-200, src/app/miniapp/payments/page.tsx:76-82, src/components/ui/PageHeader.tsx:15` — Keep the submit button in its loading state through the navigation (don't reset in finally before push; let the unmount handle it), so it reads as continuous….
- [ ] [MED·PERF] No global app-load / auth gate — first paint shows empty chrome before /auth/me resolves — `src/app/miniapp/layout.tsx:37-59, src/app/miniapp/page.tsx:63-117` — Gate the app on auth resolution: track an `authLoading` flag in AppProviders (true until /auth/me settles) and render a minimal splash/skeleton instead of ch….
- [ ] [MED·TYPE] Mono/standard digits for money + tiny amount field undersell the most important value — `src/app/miniapp/payments/page.tsx:163-171` — Make the amount field hero-sized: `text-3xl font-bold text-center` with a leading ₪ adornment and `font-mono`/`tabular-nums` so digits don't jitter while typing.
- [ ] [MED·RTL] Collapsible section chevrons in the catalog are hardcoded ChevronRight (point the wrong way in RTL) — `src/app/miniapp/settings/catalog/page.tsx:491-496, 680, 847, 870-875` — Use a logical/mirrored chevron for these disclosure toggles.
- [ ] [MED·RTL] i18n Hebrew strings hand-flip leading/trailing punctuation instead of relying on the bidi algorithm — `src/lib/i18n.ts:33,35,61,75,104,211,286` — Store strings in logical order (punctuation where it grammatically belongs: 'ברוכים הבאים!', 'שם הקבוצה...', '(אופציונלי) הערות', 'האם ההזמנה שולמה?') and le….
- [ ] [MED·LAYOUT] BottomNav active dot is mispositioned — absolute child with no relative parent (flagged 2×) — `src/components/ui/BottomNav.tsx:36,45` — Add `relative` to the <Link> className (line 36 string) so `absolute bottom-1` resolves against the tab.
- [ ] [MED·DATA] Input/TextArea have no error or required-field affordance — `src/components/ui/Input.tsx:10-56` — Add `error?: string` and `hint?: string` props.
- [ ] [MED·VIS] Status badge palette diverges from the warm bakery design tokens — `src/components/ui/Badge.tsx:5-13 (vs src/app/globals.css:128-134)` — Define a single set of status tokens in globals.css (e.g.
- [ ] [MED·TYPE] Geist + cream + terracotta reads as AI-default; primitives are the place to inject bakery craft — `src/app/globals.css:24-25 (fonts), src/components/ui/Card.tsx:13, src/components/ui/EmptyState.tsx:19` — Give the primitives a distinctive, legible voice that survives one-handed phone use: (1) swap Geist Sans for a warm humanist sans with real character for UI….
- [ ] [LOW·A11Y] Whole order/customer cards are wrapped in <Link> with nested interactive content and weak chevron contrast — `src/app/miniapp/orders/page.tsx:121-146; src/app/miniapp/customers/page.tsx:40-57` — Where a row contains a secondary action (reminder send), avoid nesting it inside the navigational <Link>: use a non-link card with an explicit primary link/b….
- [ ] [LOW·A11Y] Busy/loading buttons do not expose aria-busy and spinner is not labeled — `src/components/ui/Button.tsx:41-55` — Set aria-busy={loading} on the Button element and add aria-hidden to the decorative Loader2.
- [ ] [LOW·CONS] Customer avatar initial circle re-implemented at 4 different sizes with copy-pasted classes — `src/app/miniapp/customers/page.tsx:152; src/app/miniapp/settings/page.tsx:163; src/app/miniapp/orders/new/page.tsx:237,273; src/app/miniapp/payments/page.tsx:135,153` — Add an `<Avatar name size>` primitive that encapsulates `getInitial`, the circle, and the primary/muted tone, with a small set of sizes (e.g.
- [ ] [LOW·CONS] 'Empty list' states are inconsistent: EmptyState component on some pages, bare muted <p> on others — `src/app/miniapp/customers/[id]/page.tsx:372,402; src/app/miniapp/settings/catalog/page.tsx:507-509,722; src/components/ui/EmptyState.tsx` — Use `EmptyState` (or a lighter shared `EmptyHint` for in-card cases) consistently for all empty lists.
- [ ] [LOW·CONS] Baker page is the only surface with dark: variants, but the design system has no dark mode — `src/app/miniapp/baker/page.tsx:220-224; src/app/globals.css:33-61` — Either drop the `dark:` variants from the baker card so it matches the light-only convention used everywhere else, or commit to dark mode app-wide by adding….
- [ ] [LOW·CONS] Gram unit rendered inconsistently as Latin 'g' vs Hebrew 'ג' across recipe surfaces — `src/app/miniapp/baker/page.tsx:54-56; src/app/miniapp/orders/[id]/page.tsx:319; src/app/miniapp/orders/new/page.tsx:347; src/app/miniapp/settings/catalog/page.tsx:570,920,963` — Centralize a single `formatGrams`/weight helper (one already exists in baker/page.tsx:54 — promote it to a shared lib) and route every weight render through….
- [ ] [LOW·RTL] RTL-aware back/forward chevron logic is duplicated per page instead of centralized — `src/app/miniapp/page.tsx:57; src/app/miniapp/orders/page.tsx:41; src/app/miniapp/customers/page.tsx:38; src/app/miniapp/settings/page.tsx:34; src/components/ui/PageHeader.tsx:10` — Add a tiny shared helper or component — e.g.
- [ ] [LOW·CONS] Selectable chip pattern (sizes/additions/delivery) duplicated inline; not shared with the size pills in catalog — `src/app/miniapp/orders/new/page.tsx:337-342,375-380,450-455; src/app/miniapp/settings/catalog/page.tsx:948-951` — Extract a `Chip`/`SelectableChip` component with `selected` state and a size prop (sm for size/addition chips, md for delivery), capturing the `bg-primary/10….
- [ ] [LOW·MOTION] Page-level animate-fade-in re-runs on every route change, fighting one-handed speed — `src/app/miniapp/layout.tsx:80; src/app/globals.css:84-111` — Drop animate-fade-in from the persistent layout wrapper (or shorten to ~120ms / opacity-only with no Y translate).
- [ ] [LOW·IA] Back navigation relies on router.back() which breaks on deep links and post-submit redirects — `src/components/ui/PageHeader.tsx:7-23, src/app/miniapp/payments/page.tsx:77` — Give PageHeader an optional explicit 'up' href (e.g.
- [ ] [LOW·VIS] Bakery-craft visual identity is absent on the highest-traffic screen — generic Geist + cream/terracotta reads as AI-default — `src/app/miniapp/page.tsx:154-161,206-213` — Introduce a distinctive but legible bakery direction on the section headers and hero: pair a characterful display face (e.g.
- [ ] [LOW·VIS] Spinner color is invisible on primary buttons — busy state barely reads — `src/components/ui/Button.tsx:43-55` — Don't apply the global opacity-50 fade when `loading` (only when `disabled`); keep the loading button at full opacity so the spinner stays crisp.
- [ ] [LOW·VIS] Bakery-craft opportunity: order header and status are visually generic, not on-brand — `src/app/miniapp/orders/[id]/page.tsx:213-218,260-261` — Lean into the craft direction the design brief invites: give the StatusFlow stage icons meaning (e.g.
- [ ] [LOW·RTL] date-fns format() called without a locale — dates always formatted in English defaults — `src/lib/date-utils.ts:29-68; src/app/miniapp/baker/page.tsx:51,84` — Pass a locale to date-fns format based on lang (import { he } from 'date-fns/locale' and `format(date,'dd/MM',{locale: lang==='he'?he:undefined})`), or forma….
- [ ] [LOW·RTL] Hardcoded English aria-labels remain untranslated for the Hebrew default audience — `src/components/ui/PageHeader.tsx:17; src/app/miniapp/orders/new/page.tsx:401-423` — Add i18n keys (e.g.
- [ ] [LOW·RTL] Toast ✓/✕ icon uses physical mr-2 instead of a logical margin — `src/components/ui/Toast.tsx:43; src/app/miniapp/layout.tsx:71-79` — Replace mr-2 with the logical me-2 (margin-inline-end) so the gap sits between the icon and the message regardless of direction.
- [ ] [LOW·CONS] Toast.tsx uses raw color classes, hardcoded English-looking glyphs, and a non-RTL margin — `src/components/ui/Toast.tsx:36-43` — If keeping this component, swap `bg-green-500`→`bg-secondary text-secondary-foreground` (or a dedicated success token) and `bg-red-500`→`bg-destructive text-….
- [ ] [LOW·INT] Card has transition-shadow but no hover/interactive shadow to transition to — `src/components/ui/Card.tsx:13` — Either drop the unused `transition-shadow`, or make Card support an interactive mode: add an `interactive?: boolean` prop that adds `hover:shadow-md active:s….
- [ ] [LOW·RTL] PageHeader back-button aria-label is hardcoded English; title is not the page <h1> landmark consistently — `src/components/ui/PageHeader.tsx:7-22` — Use the i18n layer: `aria-label={t('common.back', lang)}` (add the key, e.g.

---

## Phase 2 — Control Center (catalog / recipe / config)

_Catalog + access + full-screen Bread editor + the dense Recipe editor; owner gating; hard-delete confirmations; reorder UI; reference-weight clarity._

**16 items.**

- [ ] [HIGH·COPY] Three confusing weight concepts (reference / finished / display) are never explained — `src/components/RecipeEditor.tsx:198-201, 257-263, 320-323` — Add a one-line `<p className="text-xs text-muted-foreground">` under the reference-weight Input explaining 'משקל הכיכר האפויה (לא משקל הבצק)'.
- [ ] [HIGH·INT] Ingredient rows use array index as React key, corrupting inputs on reorder/delete — `src/components/RecipeEditor.tsx:151-153, 266-267` — Give each EditorRow a stable `id` (e.g.
- [ ] [HIGH·IA] Baker's primary workspace is buried two levels deep under Settings — `src/components/ui/BottomNav.tsx:8-13, src/app/miniapp/settings/page.tsx:135-152, src/app/miniapp/layout.tsx:66` — Make the nav role-aware.
- [ ] [HIGH·INT] Catalog deletes (hard-delete) skip the confirmation that the recipe delete enforces — `src/app/miniapp/settings/catalog/page.tsx:219-227, 295-303` — Wrap each hard delete in the same confirm() pattern used in RecipeEditor (e.g.
- [ ] [HIGH·INT] All errors are silently swallowed — saves can fail with zero feedback — `src/app/miniapp/settings/page.tsx:43-49, 52-60, 96-106` — On every mutation, surface the thrown `error.message` (useApi already throws a real Error from the API's `error` field, src/hooks/useApi.ts:32-35) via `toast….
- [ ] [MED·RTL] RTL grid uses physical "g" placeholder and inline `ג` suffix that collide with Hebrew — `src/components/RecipeEditor.tsx:290, 320-323, 427, 439, 445-448` — Pick one unit token via i18n (e.g.
- [ ] [MED·CONS] Recipe delete uses native confirm() and silent failure instead of app's toast/dialog system — `src/components/RecipeEditor.tsx:231-240, 371-381` — Replace `confirm()` with the app's existing dialog/confirmation pattern (or a sonner action-toast), add a success `toast.success(t('settings.recipe_deleted')….
- [ ] [MED·LAYOUT] Fixed 4-column grid (1fr/5rem/5rem/2rem) overflows on narrow phones in RTL — `src/components/RecipeEditor.tsx:266-301` — Widen the kind/grams tracks (e.g.
- [ ] [MED·INT] Optimistic catalog toggles have no rollback — failed toggle leaves UI lying — `src/app/miniapp/settings/catalog/page.tsx:203-247, 279-323` — Wrap the bare toggles/saves in try/catch with `toast.error(t('settings.save_failed'))`.
- [ ] [MED·INT] clipboard.writeText has no fallback for non-secure / unsupported contexts — `src/app/miniapp/settings/page.tsx:62-67, 199-206` — Guard with `if (navigator.clipboard?.writeText)` and fall back to selecting the link text / a `document.execCommand('copy')` path or at minimum `toast.error`….
- [ ] [LOW·VIS] Native <select> for ingredient kind is unstyled and off the design system — `src/components/RecipeEditor.tsx:274-284` — Either wrap the native select in the same field styling tokens used by `Input` (matching focus-visible ring + radius), or replace it with a small segmented/i….
- [ ] [LOW·DATA] Baker's-% preview shows a flat wrap of name+% with no grouping or hydration callout — `src/components/RecipeEditor.tsx:309-325, 386-402` — In the preview block, reuse `groupByKind` for consistent ordering, and add a prominent derived stat line: `t('settings.hydration')` = sum(water grams)/sum(fl….
- [ ] [LOW·INT] Reference-weight edits silently overwrite hand-typed grams on rounding, with no undo — `src/components/RecipeEditor.tsx:166-178` — Rescale on blur/commit (or debounce ~300ms) rather than every keystroke, and briefly flash the rescaled gram fields (reuse the `fade-reorder`/`pulse-soft` ke….
- [ ] [LOW·INT] Recipe expand in catalog has no loading state for the detail fetch — `src/app/miniapp/settings/catalog/page.tsx:327-341` — Track a `loadingTypeDetail` flag set true at the start of expandType and false in a finally; render a small skeleton (or reuse the muted pulse bars) in the e….
- [ ] [LOW·VIS] Two stacked navigation cards share identical styling and feel undifferentiated — `src/app/miniapp/settings/page.tsx:114-152` — Group both links under one section header (e.g.
- [ ] [LOW·MOTION] Loading skeleton shape does not match the rendered page — `src/app/miniapp/settings/page.tsx:69-78` — Match the skeleton to the real structure: a short title, one input-height card, two link-card-height rows, and a taller members card with 2-3 faux rows.

---

## Phase 3 — Operational screens (home / orders / customers / payments)

_Reskin + verified bug fixes for the light front-of-house screens: live total, paid/unpaid, tap-to-call/WhatsApp, phone search, error & empty states, sticky submit, payment validation & order context, status busy/error states._

**72 items.**

- [ ] [HIGH·INT] Phone numbers are dead text — no tap-to-call or WhatsApp on a phone-first business — `src/app/miniapp/customers/[id]/page.tsx:277-289` — Make the number itself the primary action.
- [ ] [HIGH·INT] Failed data load is silently swallowed and masquerades as 'customer not found' — `src/app/miniapp/customers/[id]/page.tsx:63-78,172-179` — Track an `error` state in the catch, and render a distinct error view with a retry button (re-run the loader) instead of the not-found copy.
- [ ] [HIGH·INT] Phone deletion is a one-tap destructive action with no confirmation — `src/app/miniapp/customers/[id]/page.tsx:147-157,283-285` — Add a confirmation step before deleting — either a native `confirm()`, a small inline 'tap again to confirm' state, or (better, matching the toast system) an….
- [ ] [HIGH·IA] Search ignores phone numbers — can't find a customer by the number you have — `src/app/miniapp/customers/page.tsx:86-88, 121-129` — Include phones in the match: `c.name.toLowerCase().includes(q) || c.phones.some(p => p.phone.includes(q.replace(/\D/g,'')))`.
- [x] [HIGH·INT] Sending a WhatsApp reminder gives no confirmation step and a weak in-flight signal (flagged 2×) — `src/app/miniapp/customers/page.tsx:40-57, 167-177` — Swap the bare icon for a clearer pending state (replace MessageCircle with a `Loader2 animate-spin` while `sendingId === c.id`, mirroring Button's loading pa…. — MOOT (reminder feature removed)
- [x] [HIGH·DATA] Inactive customers look identical to active ones, yet reminders silently skip them — `src/app/miniapp/customers/page.tsx:17-22, 50-51, 145-177` — Use `isActive`: visually de-emphasize inactive rows (e.g. — MOOT (reminder feature removed)
- [ ] [HIGH·IA] Two parallel payment-recording flows that don't share state can double-charge or confuse the ledger — `src/app/miniapp/orders/[id]/page.tsx:500-585, src/app/miniapp/payments/page.tsx:62-83, src/app/miniapp/customers/[id]/page.tsx:217-222` — Unify the language and guard against duplication.
- [ ] [HIGH·INT] Dashboard fetch failure renders a silent, broken Today card with no error or retry — `src/app/miniapp/page.tsx:69-72,162-202` — Track an error state and branch on it: if the fetch rejects, set an `error` flag and render an EmptyState (icon AlertTriangle, title t('common.load_failed'))….
- [ ] [HIGH·INT] updateStatus has no error handling or loading state — silent failures and double-taps (flagged 3×) — `src/app/miniapp/orders/[id]/page.tsx:107-123, 407-427` — Wrap updateStatus in try/catch like handlePayAction does: only call setOrder after the await resolves (or roll back on catch), toast.error(t('orders.update_f….
- [ ] [HIGH·INT] Recipe expand toggle is a 3.5×3.5 icon — far below a one-handed tap target — `src/app/miniapp/orders/[id]/page.tsx:280-299,350-355` — Wrap the ChefHat in a button with p-2 and -m-2 (keeps visual size, expands hit area) or give it a min-h-9 min-w-9 flex container.
- [ ] [HIGH·INT] Destructive 'Cancel order' button sits flush beside primary actions with no confirmation (flagged 2×) — `src/app/miniapp/orders/[id]/page.tsx:407-420` — De-emphasize cancel: render it as a separate, smaller ghost/outline button on its own row (not flex-1 next to primaries), and gate it behind a confirm — eith….
- [ ] [HIGH·DATA] No live order total shown while building the order — `src/app/miniapp/orders/new/page.tsx:300-509` — Add a sticky summary bar above/inside the submit button that reduces items into a live total: sum over items of (size.price + (additionsSurcharge if breadAdd….
- [ ] [HIGH·INT] Order with delivery type 'specific_date' can be submitted with no date — `src/app/miniapp/orders/new/page.tsx:464-471,528` — Extend the disabled expression with `|| (deliveryType === 'specific_date' && !deliveryDate)`.
- [ ] [HIGH·INT] Failed order fetches silently swallow the error, leaving a blank empty state — `src/app/miniapp/orders/page.tsx:54-57, 102-115` — Add an `error` state (`const [error, setError] = useState<string|null>(null)`), set it in the `.catch`, and render a distinct error block with a Retry Button….
- [ ] [HIGH·DATA] Payment status is invisible in the list despite a `paid` field on every order — `src/app/miniapp/orders/page.tsx:21,119,133-141` — Add a small unpaid affordance on the card — e.g.
- [ ] [HIGH·INT] Customer picker has no search — unusable past ~15 customers (flagged 2×) — `src/app/miniapp/payments/page.tsx:145-160` — Add a search Input above the list that filters `customers` by name (case-insensitive `includes`), reusing the existing customer-search pattern from orders/[id].
- [ ] [HIGH·DATA] Order context (orderId/amount) is read but never shown — user can't tell what they're charging for — `src/app/miniapp/payments/page.tsx:38-40,72` — When `presetOrderId` is present, render a read-only Card above the amount showing order #, date and total (fetch via the existing order/useApi helper, or pas….
- [ ] [HIGH·INT] Negative / zero / malformed amounts pass validation — `src/app/miniapp/payments/page.tsx:62-63,185` — Parse and validate: compute `const n = Number(amount)` and require `Number.isFinite(n) && n > 0` for both the disabled state and the early return.
- [ ] [MED·DATA] StatusFlow renders an all-grey, label-only flow for any unknown status — `src/components/orders/StatusFlow.tsx:15-26, 45-73` — Guard the -1 case explicitly: if `currentIdx === -1`, render a neutral pill (like the cancelled branch) showing `labels[status] || status` instead of a misle….
- [ ] [MED·A11Y] Step timeline is decorative-only — no accessible/semantic 'current step N of 5' meaning — `src/components/orders/StatusFlow.tsx:35-74` — Wrap in a `role="list"`/`aria-label` describing the order progress, add `aria-current="step"` to the current node, and give each step an `aria-label` like `$….
- [ ] [MED·INT] StatusFlow is read-only although status changes are the page's core daily action — `src/components/orders/StatusFlow.tsx:28-77` — Make the next step tappable in-place: render the immediate next node as a large tap target (min 44px) that fires an `onAdvance(nextStatus)` callback passed f….
- [ ] [MED·DATA] Order & payment history silently truncate at 10 with no way to see the rest — `src/app/miniapp/customers/[id]/page.tsx:368-420` — When the array length exceeds the slice, append a 'View all (N)' / 'הצג הכל' Button/Link below the list (e.g.
- [ ] [MED·INT] Balance card never lets you act on a debt — the headline number is a dead end — `src/app/miniapp/customers/[id]/page.tsx:188-207` — When `balanceNum < 0`, make the card actionable: add a 'Collect ₪X' / 'גבייה' CTA that deep-links to `/miniapp/payments?customerId=...` prefilled with the ow….
- [ ] [MED·CONS] Status/balance greens use raw emerald-* instead of the design-system secondary token — `src/app/miniapp/customers/[id]/page.tsx:188-207,244,413-414` — Introduce a semantic positive/success token (e.g.
- [ ] [MED·DATA] Money is rendered with hardcoded ₪ and rounded to whole shekels, dropping agorot — `src/app/miniapp/customers/[id]/page.tsx:199-201,413-415` — Centralize money formatting in a `formatCurrency(amount, lang)` helper using `Intl.NumberFormat(lang, { style: 'currency', currency: 'ILS' })`, which gives c….
- [x] [MED·INT] 'Send reminder' is gated only on having a phone, but reminders go via Telegram, not the phone — `src/app/miniapp/customers/[id]/page.tsx:226-249` — Gate and label the button by the actual delivery channel. — MOOT (reminder feature removed)
- [ ] [MED·COPY] 'No customers yet' shown even when a search returns nothing — `src/app/miniapp/customers/page.tsx:137-142` — Branch on `search.trim()`: when a search is active and `filtered.length === 0` but `customers.length > 0`, show a 'no results' state (e.g.
- [x] [MED·INT] Whole row is a Link, so the WhatsApp button relies on preventDefault and is a tap-target trap — `src/app/miniapp/customers/page.tsx:40-57, 149-181` — Stop nesting interactives: make the card a non-anchor container, render the name area as the Link (or an onClick router.push), and keep the reminder button a…. — MOOT (reminder feature removed)
- [x] [MED·INT] Bulk 'Send Reminders' exists in i18n and the API but there's no UI to trigger it — `src/app/miniapp/customers/page.tsx:40-57, 90-100` — Add a header action next to 'Add customer' (or a selection mode) that POSTs with no/selected customerIds and reports `{sent, failed, skipped}` in a summary t…. — MOOT (reminder feature removed)
- [ ] [MED·INT] Failed initial load is swallowed — the page silently shows the empty state on a network error — `src/app/miniapp/customers/page.tsx:59-65, 131-142` — Track an error state and render a distinct 'Couldn't load customers' view with a Retry Button (re-invoking the fetch), and/or `toast.error(t('common.load_fai….
- [ ] [MED·IA] Creating an order from the dashboard dumps the user back on the dashboard, not the order they just made — `src/app/miniapp/orders/new/page.tsx:180-196` — Route create success to the new order's detail page (router.push(`/miniapp/orders/${newId}`)) like the edit path does — the POST /orders response should retu….
- [ ] [MED·IA] Order list 'completed' tab hides paid-but-not-delivered and orphans cancelled orders — `src/app/miniapp/orders/page.tsx:30,44-58,119` — Reframe tabs around jobs: e.g.
- [ ] [MED·INT] Phone delete on customer detail is immediate and unconfirmed — `src/app/miniapp/customers/[id]/page.tsx:147-157,277-289` — Add a confirm() or an undo toast (sonner supports an action button) on phone delete.
- [ ] [MED·IA] Recurring (weekly) orders have no visible management surface — set-and-forget with no way to stop or see the series — `src/app/miniapp/orders/new/page.tsx:472-490, src/app/miniapp/orders/[id]/page.tsx:241-248` — Add a 'Weekly / Standing orders' view (filter or section) listing active recurrences with pause/end controls, and make clear when editing whether changes app….
- [ ] [MED·INT] Submit blocked silently when a line item has no size, with no scent of what's wrong — `src/app/miniapp/orders/new/page.tsx:331-357,525-533` — When submit is blocked by a missing size, either keep the button enabled and surface a toast/inline error scrolling to the offending item on tap, or visibly….
- [ ] [MED·DATA] pendingCount is fetched and typed but never surfaced anywhere on the dashboard — `src/app/miniapp/page.tsx:39,135-152` — Either render pendingCount as an actionable triage chip/card near the top (e.g.
- [ ] [MED·DATA] Order 'notes' are carried in the payload and type but never shown, hiding critical fulfillment info — `src/app/miniapp/page.tsx:25,186-196` — When o.notes is present, render a subtle indicator on the Today row — e.g.
- [ ] [MED·A11Y] Quick-action cards have no keyboard focus state and rely on hover-only affordance — `src/app/miniapp/page.tsx:136-151` — Add `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 active:scale-[0.98] transition` to the Link or Card on these tiles (and th….
- [ ] [MED·DATA] totalPendingLoaves counts ALL today's orders including delivered/paid, overstating the day's bake — `src/app/api/dashboard/route.ts:132` — Compute totalPendingLoaves from only not-yet-fulfilled orders (status not in delivered/cancelled, or unpaid), or relabel the chip to 'today's loaves' to matc….
- [ ] [MED·PERF] Dashboard / orders / customers refetch with a full skeleton on every tab or remount — no stale-while-revalidate — `src/app/miniapp/orders/page.tsx:43-58,96-101, src/app/miniapp/page.tsx:63-73,119-130` — Introduce a lightweight cache (SWR or React Query, or even a module-level Map keyed by endpoint) so revisits render last-known data instantly and refresh in….
- [ ] [MED·IA] Delivered/cancelled orders offer no way to reopen or correct status — `src/app/miniapp/orders/[id]/page.tsx:65-70,207,349,384` — Add a low-emphasis 'reopen' / 'revert status' affordance for delivered and cancelled orders (e.g.
- [ ] [MED·INT] 'Notify customer' WhatsApp toggle is invisible during the deliver/pay flow despite delivery also notifying — `src/app/miniapp/orders/[id]/page.tsx:393-404,107-123` — Clarify per-action notification: show a compact notify toggle inside the deliver/pay card too (lines 430-454) if delivery should notify, and make the toggle….
- [ ] [MED·VIS] Total/price edit row is cramped and the clear-override button is a bare '✕' — `src/app/miniapp/orders/[id]/page.tsx:359-378` — Give the clear-override button an explicit label/aria-label (e.g.
- [ ] [MED·DATA] Balance is fetched lazily only for ready/delivered — pay-time UI flashes incomplete state — `src/app/miniapp/orders/[id]/page.tsx:97-101,125-132,206,561` — Show a skeleton/spinner for the balance row while balance === null inside PaymentOptions (lines 532-539) instead of omitting it, and keep the credit button s….
- [ ] [MED·DATA] StatusFlow doesn't represent the 'to_be_paid' / unpaid reality the page tracks — `src/app/miniapp/orders/[id]/page.tsx:216-218,457-479` — Reflect payment in the flow: when delivered && !paid, render the final 'delivered' node in amber/warning rather than emerald, or append a payment indicator a….
- [ ] [MED·INT] Inline 'Add customer' has no loading, error handling, or phone capture (flagged 3×) — `src/app/miniapp/orders/new/page.tsx:150-160,285-295` — Wrap the POST in try/catch with toast.error on failure, add a local creating state to disable/spinner the Add button (reuse Button's loading prop), and add a….
- [ ] [MED·INT] WhatsApp notify checkbox is unreachable for just-created customers — `src/app/miniapp/orders/new/page.tsx:511-522` — Once inline customer creation captures a phone (see related finding), the checkbox will appear naturally.
- [ ] [MED·A11Y] Form labels are not programmatically associated with their inputs — `src/app/miniapp/orders/new/page.tsx:495-508` — Pass stable ids (e.g.
- [ ] [MED·LAYOUT] Primary submit button scrolls away on a long phone form — `src/app/miniapp/orders/new/page.tsx:524-533` — Pin the submit action to the bottom as a sticky footer (e.g.
- [ ] [MED·COPY] Empty-state copy is identical across tabs and misleads on Completed/All — `src/app/miniapp/orders/page.tsx:102-115` — Branch the EmptyState on `tab`: e.g.
- [ ] [MED·DATA] No order total or price shown — owner must open each order to see what it's worth — `src/app/miniapp/orders/page.tsx:127-141` — Surface the order total (sum of item prices) as a right-aligned bold figure on each card, formatted in the locale currency, and/or show `totalQuantity` as a….
- [ ] [MED·INT] Whole card is one Link, so there is no room for inline quick actions — `src/app/miniapp/orders/page.tsx:121-146` — Restructure the row so the Link covers only the info region and add trailing icon Buttons (e.g.
- [ ] [MED·IA] List is flat with no date grouping, so 'today' deliveries don't stand out — `src/app/miniapp/orders/page.tsx:117-149` — Group the active list under sticky date headers ('Today', 'This Shabbat', 'Later') derived from `deliveryDate`, mirroring the existing date buckets in date-u….
- [ ] [MED·DATA] ASAP orders (null deliveryDate) get no date label and sort unpredictably to the top — `src/app/miniapp/orders/page.tsx:136-140` — Render an explicit chip for null dates (e.g.
- [ ] [MED·A11Y] Tab control is unlabeled for assistive tech and lacks selected-state semantics — `src/app/miniapp/orders/page.tsx:79-94` — Wrap in `role="tablist"`, give each button `role="tab"` + `aria-selected={tab===tabKey}`, and add a `focus-visible:ring` style.
- [ ] [MED·IA] No entry point passes orderId/amount, so 'charge against order' is effectively dead UX — `src/app/miniapp/payments/page.tsx:38-40,72` — Either wire the order detail's 'record payment' to deep-link here with `?orderId=&amount=&customerId=` to consolidate one payment flow, or remove the unused….
- [ ] [MED·RTL] Hebrew strings for description/toast have broken parenthesis & punctuation direction — `src/lib/i18n.ts:101-109` — Fix the source strings to logical order: `'תיאור (אופציונלי)'`, `'התשלום נרשם!'`, and `'תשלום (+)'` / `'חיוב (-)'`.
- [ ] [MED·INT] Failed customer fetch is swallowed silently — empty picker with no explanation — `src/app/miniapp/payments/page.tsx:55-60` — Track an `error` state in the catch and render an EmptyState/inline message with a retry button when the list is empty due to failure.
- [ ] [MED·INT] router.back() after success can dump the user onto the wrong screen or off-app — `src/app/miniapp/payments/page.tsx:76-77` — Navigate explicitly to a deterministic destination based on context: `router.push(presetOrderId ? \`/miniapp/orders/${presetOrderId}\` : presetCustomerId ? \….
- [ ] [LOW·DATA] Phone edit/save lacks normalization, validation, and loading state — duplicates create-flow gaps — `src/app/miniapp/customers/[id]/page.tsx:115-145,262-302` — Validate against an Israeli phone pattern before enabling the check button, normalize on save (strip/format consistently so `tabular-nums` aligns nicely), an….
- [ ] [LOW·INT] Order-history rows expose no quick payment/status action; whole card is just a link — `src/app/miniapp/customers/[id]/page.tsx:375-393` — For rows in `to_be_paid` status, add a compact inline 'Mark paid' / 'סומן שולם' icon-button (the user prefers icon buttons per design prefs) that records pay….
- [ ] [LOW·IA] Custom total is captured in two disconnected places with different mental models — `src/app/miniapp/orders/new/page.tsx:501-508, src/app/miniapp/orders/[id]/page.tsx:334-378` — Pick one primary surface.
- [ ] [LOW·IA] Empty Today state offers 'New Order' but the day's most common next action (confirm pending) is absent — `src/app/miniapp/page.tsx:162-174,206-240` — Make the dashboard resilient to the empty day: always show a compact 'Upcoming this week' summary (even '0 upcoming') and, if pendingCount>0, surface it in t….
- [ ] [LOW·INT] Customer detail phone add/edit/delete give no busy state and silent success — `src/app/miniapp/customers/[id]/page.tsx:115-157, 259-312` — Add a small busy flag (e.g.
- [ ] [LOW·IA] Root page is a server redirect — no fallback, SEO, or graceful no-JS path — `src/app/page.tsx:1-5` — Keep the redirect but add route `metadata` (title, description, og:image) on the root so shared links unfurl with the bakery brand, and consider a minimal br….
- [ ] [LOW·DATA] Per-item price uses toFixed(0) and item.pricePerUnit*qty without aligning to the override total — `src/app/miniapp/orders/[id]/page.tsx:301-305,334-348` — When totalOverride is set, add a small caption near the total like t('orders.manual_price') so the owner understands why line prices don't add up to the char….
- [ ] [LOW·INT] Quantity is a stepper only — no fast path for large counts — `src/app/miniapp/orders/new/page.tsx:397-418` — Make the quantity display a tap-to-edit numeric input (inputMode='numeric') so large quantities can be typed directly, while keeping the steppers for fine ad….
- [ ] [LOW·INT] 'No sizes available' state still lets that line item exist and shifts blame to global submit guard — `src/app/miniapp/orders/new/page.tsx:353-357,528` — Visibly flag the offending item card (e.g.
- [ ] [LOW·CONS] Fetched order is read past its declared type via `any`, hiding fields like totalOverride/isRecurring — `src/app/miniapp/orders/new/page.tsx:90-118` — Define a single OrderDetail interface that includes totalOverride, isRecurring, and items[].additions, and type the edit fetch and the Promise.all results wi….
- [ ] [LOW·INT] Initial data load can't recover from failure and ignores edit/group changes — `src/app/miniapp/orders/new/page.tsx:78-127` — On catch, set an error state and render an EmptyState/retry affordance (or toast.error + a Retry button) instead of silently showing an empty form.
- [ ] [LOW·PERF] Tab switch refetches and clears the list, causing a full skeleton flash each time — `src/app/miniapp/orders/page.tsx:43-58,96-101` — Cache results per tab (e.g.
- [ ] [LOW·DATA] Description field is generic free-text with no quick presets for common cases — `src/app/miniapp/payments/page.tsx:173-178` — Add a row of tap-to-fill chips above the description (מזומן, ביט, העברה, החזר) that set the description value, mirroring the design-pref for icon/tap afforda….

---

## Phase 4 — Baker experience

_All-light baker home / production sheet: editable recipes, error states, relative dates, by-size toggle, recipe-not-configured copy, gram precision._

**9 items.**

- [ ] [HIGH·INT] Fetch error collapses to a blank screen with no message or retry — `src/app/miniapp/baker/page.tsx:72-79, 128-238` — Add an `error` state.
- [ ] [HIGH·DATA] Date shows only a raw native picker — no day-of-week or 'Today' context for a baker planning the bake — `src/app/miniapp/baker/page.tsx:103-119` — Above or beside the picker, show `formatDateRelative(date, lang)` (e.g.
- [ ] [MED·DATA] Per-size breakdown crams all ingredients into one run-on '·'-joined line — `src/app/miniapp/baker/page.tsx:184-201` — Render the per-size ingredients as the same two-column `flex justify-between` rows used in the main recipe (name left, grams + % right, tabular-nums), option….
- [ ] [MED·COPY] Two unrelated states share the identical label 'Recipe not configured', confusing the baker — `src/app/miniapp/baker/page.tsx:196, 208, 219-237` — Differentiate copy: give the amber Card a heading like `t('baker.setup_needed')` ('דרושה הגדרה') and render each item's `reason` ('חסר מתכון' vs 'חסר משקל לג….
- [ ] [MED·INT] 'By size' toggle is a tiny low-contrast text button using '+'/'−' glyphs instead of an affordant control — `src/app/miniapp/baker/page.tsx:175-204` — Replace with a full-width tappable row (min-h-11) containing a lucide `ChevronDown` that rotates 90/180deg on expand (`transition-transform`), and apply the….
- [ ] [LOW·DATA] Grams formatter rounds to whole grams, hiding precision needed for small ingredients like salt/yeast — `src/app/miniapp/baker/page.tsx:54-60, 158` — Round adaptively: keep one decimal for sub-20g ingredients (e.g.
- [ ] [LOW·MOTION] Loading skeleton ignores the date picker and per-type structure, causing layout jump — `src/app/miniapp/baker/page.tsx:121-126` — Shape the skeleton like a real type card: a short title bar, a thin meta line, and 3-4 ingredient rows, reusing the `Card` wrapper so padding/border match.
- [ ] [LOW·INT] Re-fetch on every date change has no in-flight loading feedback on the date control and can race — `src/app/miniapp/baker/page.tsx:72-85` — Add an AbortController (or a request-id guard) in the effect to ignore stale responses, and consider a lighter inline loading affordance (e.g.
- [ ] [LOW·VIS] Distinctive bakery direction: the recipe card reads as a generic spreadsheet, not a baker's worksheet — `src/app/miniapp/baker/page.tsx:135-205` — Lean into the sourdough-worksheet metaphor for THIS read-only baking surface: promote baker's % to a first-class column, set weights/percentages in a monospa….

---

## Phase 5 — Polish backlog (low-severity, no natural screen owner)

_Pure low-severity polish that has no strong screen owner; do opportunistically._

**17 items.**

- [ ] [LOW·VIS] Adjacent step connectors use two different green thresholds, leaving a half-lit current segment — `src/components/orders/StatusFlow.tsx:38-62` — Standardize the progress accent to a single token (use the design-system `primary`/terracotta or one emerald shade for both dots and connectors), and documen….
- [ ] [LOW·COPY] 'ASAP' delivery type is left untranslated-feeling and ambiguous for the bakery context — `src/lib/i18n.ts:17` — Rename to something schedule-aware like en 'Next batch' / 'No date' and he 'באפייה הקרובה' / 'ללא תאריך', matching what the system actually does (no resolved….
- [ ] [LOW·TYPE] Trailing-ellipsis loading/saving strings use ASCII '...' inconsistently with the unicode '…' used elsewhere — `src/lib/i18n.ts:78, 107, 195, 215, 285` — Standardize on the unicode ellipsis '…' for all in-progress/placeholder labels (it kerns correctly and is the typographic standard).
- [ ] [LOW·CONS] Two near-identical 'edit a phone' / 'add a phone' inline rows duplicate ~40 lines of JSX — `src/app/miniapp/customers/[id]/page.tsx:261-306` — Extract a single `<PhoneEditorRow value onChange onConfirm onCancel confirmDisabled />` component used for both add and edit.
- [ ] [LOW·CONS] Newly added customer is sorted into place, but the initial fetched list is shown in raw server order — `src/app/miniapp/customers/page.tsx:59-65, 75` — Sort on load too (`d.customers.slice().sort((a,b)=>a.name.localeCompare(b.name, lang==='he'?'he':'en'))`) so the list is consistently ordered immediately, an….
- [x] [LOW·VIS] Reminder button color is hardcoded emerald, off the cream/terracotta design system — `src/app/miniapp/customers/page.tsx:167-177` — Use the WhatsApp-brand green only if it's intentional brand signaling for the channel; otherwise switch to a tokenized treatment such as `text-secondary hove…. — MOOT (reminder feature removed)
- [ ] [LOW·LAYOUT] Name and phone are crammed on one baseline; phone can wrap awkwardly in narrow RTL rows — `src/app/miniapp/customers/page.tsx:151-165` — Stack them: name as a block with `truncate` and phone on a second line as `text-sm text-muted-foreground` (a two-line list-item pattern).
- [ ] [LOW·MOTION] Loading skeleton geometry doesn't match the real layout, causing a layout jump — `src/app/miniapp/page.tsx:119-130` — Align the skeleton wrapper to `p-5 space-y-5` and size the two quick-action placeholders to match the real card height (~h-[68px]), then mirror the section c….
- [x] [LOW·INT] Per-customer reminder send shows feedback via opacity flicker, not a clear spinner — `src/app/miniapp/customers/page.tsx:40-57, 168-177` — Swap the MessageCircle for the Loader2 spinner while `sendingId === c.id` so the busy row reads unambiguously, matching the rest of the app's spinner convention. — MOOT (reminder feature removed)
- [ ] [LOW·PERF] Bare loading text with opacity-50 — no skeleton or spinner on the most latency-sensitive screen — `src/app/miniapp/join/[code]/page.tsx:46-53` — Reuse the Button's `Loader2` spinner pattern or a small skeleton Card matching the result layout (a placeholder line + two ghost buttons) so the screen has s….
- [ ] [LOW·COPY] Items card header is mislabeled 'bread type' and lacks a real section title — `src/app/miniapp/orders/[id]/page.tsx:261` — Use a dedicated key like t('orders.items') ('Items' / 'פריטים') or t('orders.order_contents') for the heading on line 261 instead of reusing the form field l….
- [ ] [LOW·CONS] Bread type uses a native select while sizes/additions use chips — inconsistent selection model — `src/app/miniapp/orders/new/page.tsx:313-352` — If the bread-type list is small, render it as a horizontally scrollable chip row matching the size chips for a consistent tap-to-pick model and on-brand styling.
- [ ] [LOW·DATA] Custom-total field has no currency affordance and a misleading '0' placeholder — `src/app/miniapp/orders/new/page.tsx:501-508` — Prefix the field with a ₪ adornment to match the rest of the form, and change the placeholder/helper to show the auto-calculated total (e.g.
- [ ] [LOW·LAYOUT] itemsSummary can overflow to a single truncated/wrapping line with no clamp — `src/app/miniapp/orders/page.tsx:131` — Add `line-clamp-1` (or `line-clamp-2`) to the itemsSummary div so rows stay uniform; the full breakdown is on the detail page.
- [ ] [LOW·VIS] Recurring marker and the new-order CTA lean on icon/color alone — `src/app/miniapp/orders/page.tsx:128,142` — Give the Repeat icon an `aria-label`/`title` ('הזמנה קבועה / Recurring') or pair it with a tiny text chip.
- [ ] [LOW·COPY] 'Recording…' loading label exists in i18n but the button shows none — `src/app/miniapp/payments/page.tsx:181-190` — Swap the button label to `t('payments.recording')` while `submitting` is true, giving clearer feedback than a bare spinner over a stale amount.
- [ ] [LOW·A11Y] Type toggle uses raw buttons with color-only state and no selected ARIA — `src/app/miniapp/payments/page.tsx:104-127` — Add `role="radiogroup"` to the wrapper and `role="radio" aria-checked={type==='payment'}` to each button (or `aria-pressed`).

---

## MOOT (resolved by scope cut)

_These 24 findings were considered and intentionally dropped — they vanish once i18n is removed (Hebrew-only) or multi-tenant/groups is removed (single implicit bakery, baker access = one share link)._

### Resolved by removing i18n (Hebrew-only)

- [x] [HIGH·COPY] Bulk-reminder strings use {count}/{sent}/{total} but t() has no interpolation — `src/lib/i18n.ts:197-198, 299-301` — MOOT: i18n removed: t() interpolation gap moot once the bilingual dictionary collapses.
- [x] [HIGH·RTL] Hardcoded Hebrew 'עם' in item summaries leaks into the English UI — `src/lib/order-display.ts:13-15` — MOOT: i18n removed: Hebrew-only, no English path for hardcoded עם.
- [x] [HIGH·RTL] Hardcoded Hebrew 'עם …' and 'ג' unit break the English i18n path — `src/app/miniapp/orders/[id]/page.tsx:273,318,325,326` — MOOT: i18n removed: Hebrew-only — עם/ג no longer leak into an English UI.
- [x] [MED·RTL] Date stepper chevron icons are hardcoded and reverse in LTR/English — `src/app/miniapp/baker/page.tsx:106-117` — MOOT: i18n removed: chevrons never flip — app is RTL-only.
- [x] [MED·COPY] Reminder bulk-flow strings are defined but never consumed (dead keys) — `src/lib/i18n.ts:196-199` — MOOT: i18n removed: dead bulk-reminder keys dropped with the dictionary.
- [x] [MED·COPY] Missing-translation fallback silently renders raw dotted keys to the user — `src/lib/i18n.ts:299-301` — MOOT: i18n removed: missing-translation key-leak fallback is moot Hebrew-only.
- [x] [MED·IA] No language switcher despite a built-in i18n system — `src/app/miniapp/settings/page.tsx:6, 33-34` — MOOT: i18n removed: no language switcher needed (Hebrew-only).
- [x] [LOW·CONS] Duplicate values across keys create maintenance drift and translator confusion — `src/lib/i18n.ts:10, 43, 90-91, 180, 235, 259, 271` — MOOT: i18n removed: duplicate en/he key pairs vanish when collapsing to single-locale strings.

### Resolved by removing multi-tenant / groups

- [x] [HIGH·INT] Invite-fetch failures and 'invalid invite' look identical — no error vs. expired distinction — `src/app/miniapp/join/[code]/page.tsx:24-29, 55-62` — MOOT: groups removed: SaaS invite/accept flow dropped.
- [x] [HIGH·IA] Dead-end on a revoked/expired invite — no way out except the browser back button — `src/app/miniapp/join/[code]/page.tsx:55-62` — MOOT: groups removed: invite accept/expire screen dropped.
- [x] [HIGH·RTL] Sentence assembled from i18n fragments breaks Hebrew RTL word order — `src/app/miniapp/join/[code]/page.tsx:69-72; src/lib/i18n.ts:207-208` — MOOT: groups removed: join-invite sentence (i18n fragments) dropped.
- [x] [HIGH·DATA] Pending invites are fetched but never displayed — `src/app/miniapp/settings/page.tsx:23-58, 177-208` — MOOT: groups removed: pending-invites list dissolves with multi-tenant.
- [x] [HIGH·A11Y] No role gating — bakers see and can trigger owner-only actions — `src/app/miniapp/settings/page.tsx:18-20, 84-208` — MOOT: groups removed: no manager/baker role-gating in a single bakery (access = share link).
- [x] [MED·IA] Group onboarding offers only 'create group' — an invited user with a pending invite has no entry point — `src/app/miniapp/page.tsx:75-117` — MOOT: groups removed: no create-group / pending-invite onboarding.
- [x] [MED·INT] Group-name save (settings) swallows errors and shows no success confirmation — `src/app/miniapp/settings/page.tsx:52-67, 96-106` — MOOT: groups removed: group-name save dissolves (only the surcharge becomes a plain setting).
- [x] [MED·INT] Accept/Decline buttons fake a loading state with '...' instead of the Button's built-in spinner — `src/app/miniapp/join/[code]/page.tsx:75-82` — MOOT: groups removed: invite accept/decline flow dropped.
- [x] [MED·INT] Decline has no confirmation and silently sends the user into an empty app — `src/app/miniapp/join/[code]/page.tsx:31-44, 75-82` — MOOT: groups removed: invite decline flow dropped.
- [x] [MED·LAYOUT] Bottom navigation bar bleeds onto the invite screen for a non-member — `src/app/miniapp/join/[code]/page.tsx:64-85; src/app/miniapp/layout.tsx:80-88` — MOOT: groups removed: onboarding/join screen dropped.
- [x] [MED·COPY] Unknown invite role renders a raw translation key like 'role.customer' — `src/app/miniapp/join/[code]/page.tsx:72; src/lib/i18n.ts:20-22,299-300` — MOOT: groups removed: invite-role rendering dropped.
- [x] [MED·INT] Group Name Save gives no success confirmation — `src/app/miniapp/settings/page.tsx:92-110` — MOOT: groups removed: no editable Group Name field.
- [x] [MED·INT] Members are read-only — no role change or remove action — `src/app/miniapp/settings/page.tsx:159-173` — MOOT: groups removed: no member role-change/remove.
- [x] [MED·COPY] Invite role toggle lacks an explanation of what each role can do — `src/app/miniapp/settings/page.tsx:182-198` — MOOT: groups removed: no invite role toggle (baker access = single share link).
- [x] [LOW·COPY] Generic 'Group Invite' header wastes the brand's first impression — `src/app/miniapp/join/[code]/page.tsx:64-73; src/lib/i18n.ts:206` — MOOT: groups removed: invite "Group Invite" brand screen dropped.
- [x] [LOW·DATA] Members list has no empty state and no count — `src/app/miniapp/settings/page.tsx:155-174` — MOOT: groups removed: no members list.
