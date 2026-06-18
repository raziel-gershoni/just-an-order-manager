# Customer Reminders (WhatsApp) — Design Spec

- **Date:** 2026-06-17
- **Status:** **Implemented** 2026-06-17 (plan: `docs/superpowers/plans/2026-06-17-customer-reminders.md`). Out-of-scope/future items below remain unbuilt. Pending: owner must register the Meta templates and add them in the תזכורות tab, then run the manual smoke test.
- **Author:** Claude (with Raziel)

## 1. Context & Goal

The app reaches **customers over WhatsApp** (the Telegram bot is staff-only — customers have no Telegram). A reminder feature existed before (`/api/customers/remind`, per-customer + bulk modal) and was removed in `48be09d` because WhatsApp bills marketing-category messages per message. The owner is now ready to pay and wants reminders back, but with **granular control** (per phone / per customer / a hand-picked set — never a blast to everyone) and **several rotating message variants** organized around two occasions:

- **Week-start** — "order bread for the rest of the week."
- **Shabbat** — mid-week nudge for the Friday (Shabbat) bake.

## 2. The constraint that shapes the design

A proactive "come order bread" message is a **marketing** message to WhatsApp. It **cannot be free text** typed in the app — each variant must be **pre-registered as a template in Meta Business Manager and approved** (Hebrew, one approval per variant). Free text is only allowed inside the 24h window after a customer messages us first, which never applies to a reminder.

**Therefore the app is a *launcher* over approved Meta templates, not a composer.** Templates may personalize via a `{{1}}` name variable (the old one: `היי {{1}}! רוצה להזמין לחם השבוע? 🍞`). Registering templates in Meta is a manual owner step; the app stores each template's Meta name plus friendly metadata.

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Trigger | **Manual only** — owner/manager selects recipients and sends. No cron/auto-send in v1. |
| Template model | **Occasion-tagged, several per occasion, auto-rotated.** Sender picks the *occasion*; the app picks the *variant*. |
| Rotation | Round-robin by `sortOrder`, advancing from each customer's last-sent variant for that occasion (per the send log). New customers get the first active variant. |
| Send log | **Yes** — every send logged (also powers rotation). |
| Opt-out | **Manual admin flag** per customer (`reminderOptOut`). No inbound webhook / auto opt-out. Opted-out customers are excluded from sends. |
| Roles | Owner + manager only (bakers excluded), matching the removed feature. |

## 4. Data model (additive — one migration `0010_customer_reminders.sql`)

**New table `reminder_templates`** (the in-app library):

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `groupId` | int FK → groups.id | scope |
| `label` | varchar(255) | friendly Hebrew name shown to the owner |
| `metaTemplateName` | varchar(255) | must match the approved Meta template exactly |
| `occasion` | enum `week_start` \| `shabbat` | |
| `bodyPreview` | text | Hebrew text, display-only (kept in sync by hand with Meta) |
| `isActive` | boolean default true | pause without deleting |
| `sortOrder` | int default 0 | rotation order |
| `createdAt` | timestamp | |

**New table `reminder_sends`** (log + rotation fuel):

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `groupId` | int FK → groups.id | |
| `customerId` | int FK → customers.id | |
| `phoneId` | int FK → customer_phones.id | which number |
| `templateId` | int FK → reminder_templates.id | variant sent |
| `occasion` | enum | denormalized for easy rotation lookup |
| `status` | enum `sent` \| `failed` | |
| `sentAt` | timestamp | |

**Altered table `customers`** — add `reminderOptOut boolean NOT NULL DEFAULT false`.

All additive; no data loss. Next migration number is **0010** (last is `0009_phone_name`). Runs automatically on Vercel deploy.

## 5. Rotation algorithm

For each `(customer, occasion)` at send time:
1. Load active templates for that occasion in this group, ordered by `sortOrder`.
2. If none → abort the whole send with a clear error ("אין תבניות פעילות עבור ...").
3. Find the customer's most-recent `reminder_sends` row for that occasion → its `templateId` = last variant.
4. Pick the **next** active template after it in `sortOrder` order, wrapping to the first. No history → first active template.

Deterministic, simple, and "cycles through" exactly as the owner described. The rotation key is `(customerId, occasion)` regardless of phone, so all of a customer's numbers get the same variant in a single send.

## 6. Send flow (manual)

1. **Pick recipients** — three entry points:
   - **One phone** — from a customer profile, a single number.
   - **A whole customer** — all that customer's numbers.
   - **Several customers** — multi-select mode on the customers list. *No "send to everyone" button — deliberate friction.*
2. **Pick the occasion** (week-start / Shabbat).
3. App resolves the rotated variant per customer, **skips opted-out customers**, normalizes phones (`normalizePhoneNumber`). **No template variables for now** — templates send as-is (the `{{1}}` name slot was dropped per owner; re-add by passing a name param to `sendWhatsAppTemplate` in `/api/reminders/send`).
4. **Confirm sheet** — "שליחת N תזכורות", a preview of the variant(s), and a note of any excluded (opted-out) recipients. Each message costs, so the count + confirm is mandatory.
5. Send via the existing `sendWhatsAppTemplate` (reuse `notifyCustomerWhatsApp`'s pattern, `Promise.allSettled`). Write one `reminder_sends` row per number with `sent`/`failed`.
6. Result toast: "נשלחו N • נכשלו M • לא נשלחו (חסומים) K".

## 7. API

| Endpoint | Method | Role | Purpose |
|---|---|---|---|
| `/api/reminder-templates` | GET / POST | owner, manager | list / create template |
| `/api/reminder-templates/[id]` | PATCH / DELETE | owner, manager | edit / remove (or soft-pause via `isActive`) |
| `/api/reminders/send` | POST | owner, manager | body `{ occasion, customerIds?, phoneId? }`; resolves rotation + opt-out, sends, logs; returns `{ sent, failed, skippedOptOut }` |
| `/api/customers/[id]` | PATCH (existing) | owner, manager | add `reminderOptOut` to updatable fields |

Optional later: `GET /api/reminders/preview` to show each recipient's resolved variant before sending.

## 8. UI surfaces (existing DOCKET patterns)

- **New Control Center tab "תזכורות"** (`/miniapp/settings/reminders`) — manage the template library as docket strips: label, occasion chip, preview, active toggle (the catalog's `toggleTypeActive` pattern), reorder, full-screen overlay editor (the bread-editor pattern). Owner/manager only.
- **Customer profile** (`/miniapp/customers/[id]`) — a "שלח תזכורת" action (occasion → confirm), plus the **opt-out toggle** ("לא לשלוח תזכורות").
- **Customers list** (`/miniapp/customers`) — a multi-select mode (checkboxes) → occasion → confirm. Opted-out customers shown muted / not selectable.

## 9. Out of scope (v1) / future

- Scheduled / cron auto-sends (e.g. "every Tuesday for Shabbat regulars"). Manual only for now.
- Inbound WhatsApp webhook / automatic opt-out from "STOP" replies. Opt-out is a manual admin flag.
- Auto-creating or syncing Meta templates from the app via the Graph API (owner registers them in Meta, then adds the name here).
- Cost estimation in the confirm sheet (only a count for now).

## 10. Notes / risks

- **Number health:** Meta can throttle/ban a number that draws marketing complaints. Mitigated by: known opt-in customer base, the manual opt-out flag, and no blast-all button. Acceptable for a single personal bakery.
- **Preview drift:** `bodyPreview` is hand-kept and can drift from the real Meta template. It is display-only; the actual send always uses `metaTemplateName`.
