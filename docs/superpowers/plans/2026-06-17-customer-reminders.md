# Customer Reminders (WhatsApp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner/manager send WhatsApp reminders to selected customers — per phone, per customer, or a multi-selected set — using occasion-tagged, auto-rotating, pre-approved Meta templates, with a manual opt-out flag and a send log.

**Architecture:** Two new tables (`reminder_templates`, `reminder_sends`) + a `reminder_opt_out` column on `customers`. A pure rotation helper (`src/lib/reminders.ts`) picks the next template per `(customer, occasion)` from the send log. Template CRUD and a send endpoint sit under `/api/reminder-templates` and `/api/reminders/send`. UI: a new "תזכורות" Control Center tab to manage templates, a per-customer/per-phone send sheet + opt-out toggle on the customer profile, and a multi-select bulk-send on the customers list. The app references approved Meta templates by name and personalizes via a `{{1}}` name param — it never composes free text.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 (DOCKET tokens), drizzle-orm + Neon, grammY (unrelated to this feature — customers are WhatsApp-only), `sendWhatsAppTemplate` (Meta Graph API v21).

**Design spec:** `docs/superpowers/specs/2026-06-17-customer-reminders-design.md`

---

## Verification model (read first)

This repo has **no automated test runner** — `package.json` has no `test` script, and there is no vitest/jest. The established gate is:

1. `npx tsc --noEmit` must be clean (the hard gate).
2. `npx tsx -e "…"` for the one pure algorithm (rotation) — tsx is a dev dependency and runs `.ts` directly.
3. Visual verification of new UI via a headless-Chrome harness in `/tmp/mockups/` (the project's established pattern) before pushing.
4. Manual smoke test in the deployed app for end-to-end WhatsApp sends (can't be exercised locally — no WhatsApp creds, and sends cost money).

Each task therefore ends with: `npx tsc --noEmit` → (where applicable) a tsx/harness check → commit. **Do NOT add a test framework** — it's out of scope and contrary to the repo's conventions.

Migrations run automatically on deploy (`build: tsx scripts/migrate.ts && next build`). Do not run `db:migrate` against production manually.

Commit trailer for every commit:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## File Structure

**Create:**
- `src/lib/reminders.ts` — pure rotation helper (`pickNextTemplate`). No imports beyond types so it's tsx-checkable in isolation.
- `src/app/api/reminder-templates/route.ts` — `GET` (list) + `POST` (create) templates.
- `src/app/api/reminder-templates/[id]/route.ts` — `PATCH` (update) + `DELETE` (guarded) a template.
- `src/app/api/reminders/send/route.ts` — `POST` resolve rotation + opt-out, send, log.
- `src/app/miniapp/settings/reminders/page.tsx` — template management page.
- `src/components/ui/SendReminderSheet.tsx` — reusable occasion-pick + confirm sheet (used by profile and list).
- `drizzle/0010_customer_reminders.sql` — generated migration (verify, don't hand-edit unless drizzle prompts).

**Modify:**
- `src/db/schema.ts` — add 2 enums, 2 tables, `reminderOptOut` column.
- `src/components/ui/ControlCenterTabs.tsx` — add the "תזכורות" tab.
- `src/lib/i18n.ts` — reminder strings (all added once in Task 6).
- `src/app/api/customers/[id]/route.ts` — accept `reminderOptOut` on PATCH; return it on GET.
- `src/app/api/customers/route.ts` — return `reminderOptOut` in the list.
- `src/app/miniapp/customers/[id]/page.tsx` — opt-out toggle + send actions (customer + per phone).
- `src/app/miniapp/customers/page.tsx` — multi-select mode + bulk send.

---

## Task 1: Schema + migration

**Files:**
- Modify: `src/db/schema.ts` (enums block ~line 17–40; after `customerPhones` ~line 230; `customers` table ~line 206–219)
- Create (generated): `drizzle/0010_customer_reminders.sql`

- [ ] **Step 1: Add the two enums** in the `// ---- Enums ----` block of `src/db/schema.ts`, after `inviteStatusEnum`:

```ts
export const reminderOccasionEnum = pgEnum('reminder_occasion', [
  'week_start',
  'shabbat',
]);

export const reminderSendStatusEnum = pgEnum('reminder_send_status', [
  'sent',
  'failed',
]);
```

- [ ] **Step 2: Add `reminderOptOut` to the `customers` table** (inside the existing `pgTable('customers', {...})`, after `isActive`):

```ts
  reminderOptOut: boolean('reminder_opt_out').notNull().default(false),
```

- [ ] **Step 3: Add the two tables** at the end of `src/db/schema.ts` (after `customerPhones`; they reference `groups`, `customers`, `customerPhones` which are all defined above):

```ts
export const reminderTemplates = pgTable('reminder_templates', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id),
  label: varchar('label', { length: 255 }).notNull(),
  metaTemplateName: varchar('meta_template_name', { length: 255 }).notNull(),
  occasion: reminderOccasionEnum('occasion').notNull(),
  bodyPreview: text('body_preview'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const reminderSends = pgTable('reminder_sends', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id),
  customerId: integer('customer_id')
    .notNull()
    .references(() => customers.id),
  phoneId: integer('phone_id')
    .notNull()
    .references(() => customerPhones.id),
  templateId: integer('template_id')
    .notNull()
    .references(() => reminderTemplates.id),
  occasion: reminderOccasionEnum('occasion').notNull(),
  status: reminderSendStatusEnum('status').notNull(),
  sentAt: timestamp('sent_at').notNull().defaultNow(),
});
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate --name=customer_reminders`
Expected: creates `drizzle/0010_customer_reminders.sql` and updates `drizzle/meta/_journal.json` (new entry idx 10). **No interactive prompt** — these are pure additions (no renames). If drizzle *does* prompt about a rename, press Ctrl-C and use the fallback in the note below.

- [ ] **Step 5: Verify the generated SQL** contains (order may vary; drizzle emits `--> statement-breakpoint` between statements):

```sql
CREATE TYPE "public"."reminder_occasion" AS ENUM('week_start', 'shabbat');
CREATE TYPE "public"."reminder_send_status" AS ENUM('sent', 'failed');
CREATE TABLE "reminder_templates" ( ... );
CREATE TABLE "reminder_sends" ( ... );
ALTER TABLE "customers" ADD COLUMN "reminder_opt_out" boolean DEFAULT false NOT NULL;
```

Read `drizzle/0010_customer_reminders.sql` and confirm both tables, both enums, the FKs, and the ADD COLUMN are present.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): reminder_templates + reminder_sends tables, reminderOptOut column"
```

> **Fallback if drizzle-kit prompts interactively:** `pnpm db:generate --custom --name=customer_reminders` creates an empty journaled migration; hand-write the SQL above into it (mirror the column types/FKs exactly), then re-run Step 6–7.

---

## Task 2: Rotation helper (pure, tsx-verified)

**Files:**
- Create: `src/lib/reminders.ts`

- [ ] **Step 1: Write the helper** — keep it dependency-free (only a local type) so it runs under `tsx -e`:

```ts
/** A template candidate for rotation: only the id matters here. */
export interface RotatableTemplate {
  id: number;
}

/**
 * Pick the next template for a (customer, occasion) round-robin.
 * @param templates active templates for the occasion, sorted by sortOrder asc
 * @param lastTemplateId the templateId of this customer's most recent send for
 *   the occasion, or null if they've never been reminded for it
 * Returns the template AFTER lastTemplateId (wrapping), the first when there is
 * no history, or null when there are no templates. If lastTemplateId is no
 * longer among the active templates, restarts from the first.
 */
export function pickNextTemplate<T extends RotatableTemplate>(
  templates: T[],
  lastTemplateId: number | null
): T | null {
  if (templates.length === 0) return null;
  if (lastTemplateId == null) return templates[0];
  const idx = templates.findIndex((t) => t.id === lastTemplateId);
  if (idx === -1) return templates[0];
  return templates[(idx + 1) % templates.length];
}
```

- [ ] **Step 2: Verify the rotation logic with tsx** (no test framework needed)

Run:
```bash
npx tsx -e "
import { pickNextTemplate } from './src/lib/reminders.ts';
const ts = [{id:10},{id:20},{id:30}];
const eq = (a,b,msg) => { if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error('FAIL '+msg+': '+JSON.stringify(a)); };
eq(pickNextTemplate(ts, null), {id:10}, 'no-history->first');
eq(pickNextTemplate(ts, 10), {id:20}, 'after-10->20');
eq(pickNextTemplate(ts, 30), {id:10}, 'wrap-30->10');
eq(pickNextTemplate(ts, 999), {id:10}, 'stale-last->first');
eq(pickNextTemplate([], 10), null, 'empty->null');
console.log('rotation OK');
"
```
Expected: prints `rotation OK` (throws on any mismatch).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/reminders.ts
git commit -m "feat(reminders): round-robin template rotation helper"
```

---

## Task 3: Template CRUD API

**Files:**
- Create: `src/app/api/reminder-templates/route.ts`
- Create: `src/app/api/reminder-templates/[id]/route.ts`

- [ ] **Step 1: List + create** — `src/app/api/reminder-templates/route.ts`:

```ts
import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { reminderTemplates } from '@/db/schema';
import { eq, and, asc, sql } from 'drizzle-orm';
import { z } from 'zod/v4';

export const GET = withGroup(async (_request, _auth, groupId) => {
  const templates = await db
    .select()
    .from(reminderTemplates)
    .where(eq(reminderTemplates.groupId, groupId))
    .orderBy(asc(reminderTemplates.occasion), asc(reminderTemplates.sortOrder));
  return jsonResponse({ templates });
});

const createSchema = z.object({
  label: z.string().min(1).max(255),
  metaTemplateName: z.string().min(1).max(255),
  occasion: z.enum(['week_start', 'shabbat']),
  bodyPreview: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const POST = withGroup(async (request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (membership?.role === 'baker') {
    return errorResponse('Bakers cannot manage reminders', 403);
  }

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [{ maxSort }] = await db
    .select({ maxSort: sql<number>`coalesce(max(${reminderTemplates.sortOrder}), -1)` })
    .from(reminderTemplates)
    .where(eq(reminderTemplates.groupId, groupId));

  const [template] = await db
    .insert(reminderTemplates)
    .values({
      groupId,
      label: parsed.data.label,
      metaTemplateName: parsed.data.metaTemplateName,
      occasion: parsed.data.occasion,
      bodyPreview: parsed.data.bodyPreview ?? null,
      isActive: parsed.data.isActive ?? true,
      sortOrder: maxSort + 1,
    })
    .returning();

  return jsonResponse({ template }, 201);
});
```

- [ ] **Step 2: Update + delete** — `src/app/api/reminder-templates/[id]/route.ts`:

```ts
import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { reminderTemplates, reminderSends } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';

function getId(url: string): number {
  const parts = new URL(url).pathname.split('/');
  return Number(parts[parts.length - 1]);
}

const updateSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  metaTemplateName: z.string().min(1).max(255).optional(),
  occasion: z.enum(['week_start', 'shabbat']).optional(),
  bodyPreview: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const PATCH = withGroup(async (request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (membership?.role === 'baker') {
    return errorResponse('Bakers cannot manage reminders', 403);
  }
  const id = getId(request.url);
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);

  const [template] = await db
    .update(reminderTemplates)
    .set(parsed.data)
    .where(and(eq(reminderTemplates.id, id), eq(reminderTemplates.groupId, groupId)))
    .returning();
  if (!template) return errorResponse('Template not found', 404);
  return jsonResponse({ template });
});

export const DELETE = withGroup(async (request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (membership?.role === 'baker') {
    return errorResponse('Bakers cannot manage reminders', 403);
  }
  const id = getId(request.url);

  // Hard delete only when no send history references it; otherwise pause instead
  // (templateId is a NOT NULL FK in reminder_sends).
  const [used] = await db
    .select({ id: reminderSends.id })
    .from(reminderSends)
    .where(eq(reminderSends.templateId, id))
    .limit(1);
  if (used) {
    return errorResponse('Template has send history — pause it instead', 409);
  }

  const [deleted] = await db
    .delete(reminderTemplates)
    .where(and(eq(reminderTemplates.id, id), eq(reminderTemplates.groupId, groupId)))
    .returning({ id: reminderTemplates.id });
  if (!deleted) return errorResponse('Template not found', 404);
  return jsonResponse({ success: true });
});
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/reminder-templates
git commit -m "feat(api): reminder template CRUD (owner/manager only)"
```

---

## Task 4: Send API

**Files:**
- Create: `src/app/api/reminders/send/route.ts`

Resolves rotation per customer, skips opted-out customers, sends one WhatsApp per target phone, logs each send. Body: `{ occasion, customerIds?: number[], phoneId?: number }`. `phoneId` → single-phone send; `customerIds` → all phones of each customer.

- [ ] **Step 1: Write the route** — `src/app/api/reminders/send/route.ts`:

```ts
import { withGroup, jsonResponse, errorResponse } from '@/lib/api-utils';
import { db } from '@/db';
import { reminderTemplates, reminderSends, customers, customerPhones } from '@/db/schema';
import { eq, and, asc, desc, inArray } from 'drizzle-orm';
import { z } from 'zod/v4';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';
import { pickNextTemplate } from '@/lib/reminders';
import { phoneContactName } from '@/lib/name-utils';

const sendSchema = z
  .object({
    occasion: z.enum(['week_start', 'shabbat']),
    customerIds: z.array(z.number().int().positive()).optional(),
    phoneId: z.number().int().positive().optional(),
  })
  .refine((d) => d.phoneId != null || (d.customerIds && d.customerIds.length > 0), {
    message: 'Provide phoneId or customerIds',
  });

export const POST = withGroup(async (request, auth, groupId) => {
  const membership = auth.memberships.find((m) => m.groupId === groupId);
  if (membership?.role === 'baker') {
    return errorResponse('Bakers cannot send reminders', 403);
  }

  const body = await request.json();
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) return errorResponse(parsed.error.message);
  const { occasion } = parsed.data;

  // Active templates for this occasion, in rotation order.
  const templates = await db
    .select()
    .from(reminderTemplates)
    .where(
      and(
        eq(reminderTemplates.groupId, groupId),
        eq(reminderTemplates.occasion, occasion),
        eq(reminderTemplates.isActive, true)
      )
    )
    .orderBy(asc(reminderTemplates.sortOrder));
  if (templates.length === 0) {
    return errorResponse('No active templates for this occasion', 400);
  }

  // Resolve the target phones, grouped by customer.
  type Target = { customerId: number; phoneId: number; phone: string; phoneName: string | null; customerName: string };
  let targets: Target[] = [];
  let skippedOptOut = 0;

  if (parsed.data.phoneId != null) {
    const [row] = await db
      .select({
        phoneId: customerPhones.id,
        phone: customerPhones.phone,
        phoneName: customerPhones.name,
        customerId: customers.id,
        customerName: customers.name,
        optOut: customers.reminderOptOut,
      })
      .from(customerPhones)
      .innerJoin(customers, eq(customerPhones.customerId, customers.id))
      .where(and(eq(customerPhones.id, parsed.data.phoneId), eq(customers.groupId, groupId)))
      .limit(1);
    if (!row) return errorResponse('Phone not found', 404);
    if (row.optOut) skippedOptOut = 1;
    else targets = [{ customerId: row.customerId, phoneId: row.phoneId, phone: row.phone, phoneName: row.phoneName, customerName: row.customerName }];
  } else {
    const ids = parsed.data.customerIds!;
    const custRows = await db
      .select({ id: customers.id, name: customers.name, optOut: customers.reminderOptOut })
      .from(customers)
      .where(and(eq(customers.groupId, groupId), inArray(customers.id, ids)));
    const allowed = custRows.filter((c) => !c.optOut);
    skippedOptOut = custRows.length - allowed.length;
    const allowedIds = allowed.map((c) => c.id);
    const nameById = new Map(allowed.map((c) => [c.id, c.name]));
    if (allowedIds.length > 0) {
      const phones = await db
        .select({ phoneId: customerPhones.id, phone: customerPhones.phone, phoneName: customerPhones.name, customerId: customerPhones.customerId })
        .from(customerPhones)
        .where(inArray(customerPhones.customerId, allowedIds))
        .orderBy(asc(customerPhones.sortOrder));
      targets = phones.map((p) => ({
        customerId: p.customerId,
        phoneId: p.phoneId,
        phone: p.phone,
        phoneName: p.phoneName,
        customerName: nameById.get(p.customerId) ?? '',
      }));
    }
  }

  // Resolve the rotated template ONCE per customer (all their phones get it).
  const customerIdsToSend = [...new Set(targets.map((t) => t.customerId))];
  const templateByCustomer = new Map<number, typeof templates[number]>();
  for (const cid of customerIdsToSend) {
    const [last] = await db
      .select({ templateId: reminderSends.templateId })
      .from(reminderSends)
      .where(and(eq(reminderSends.customerId, cid), eq(reminderSends.occasion, occasion)))
      .orderBy(desc(reminderSends.sentAt))
      .limit(1);
    const next = pickNextTemplate(templates, last?.templateId ?? null);
    if (next) templateByCustomer.set(cid, next);
  }

  // Send + log, one row per phone.
  let sent = 0;
  let failed = 0;
  const results = await Promise.allSettled(
    targets.map(async (tgt) => {
      const template = templateByCustomer.get(tgt.customerId);
      if (!template) return;
      const { firstName } = phoneContactName(tgt.customerName, tgt.phoneName);
      const ok = await sendWhatsAppTemplate(tgt.phone, template.metaTemplateName, 'he', [firstName]);
      await db.insert(reminderSends).values({
        groupId,
        customerId: tgt.customerId,
        phoneId: tgt.phoneId,
        templateId: template.id,
        occasion,
        status: ok ? 'sent' : 'failed',
      });
      if (ok) sent += 1;
      else failed += 1;
    })
  );
  // Surface unexpected exceptions (DB insert failures etc.) as failures.
  for (const r of results) if (r.status === 'rejected') failed += 1;

  return jsonResponse({ sent, failed, skippedOptOut });
});
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. (Confirms `phoneContactName`, `sendWhatsAppTemplate`, `pickNextTemplate`, and schema imports line up.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/reminders
git commit -m "feat(api): send reminders with rotation, opt-out skip, and send log"
```

---

## Task 5: Expose opt-out on customer API

**Files:**
- Modify: `src/app/api/customers/[id]/route.ts` (GET select + PATCH body schema/update)
- Modify: `src/app/api/customers/route.ts` (list select)

- [ ] **Step 1: Read both files** to find the exact GET `select({...})` and PATCH update objects.

Run: `grep -n "reminderOptOut\|select(\|\.set(\|isActive\|z.object" src/app/api/customers/[id]/route.ts src/app/api/customers/route.ts`

- [ ] **Step 2: In `src/app/api/customers/[id]/route.ts`** — add `reminderOptOut: customers.reminderOptOut` to the GET `select({...})` for the customer, add `reminderOptOut: z.boolean().optional()` to the PATCH zod schema, and include it in the `.set({...})` update object (only when provided — if the existing code spreads `parsed.data`, it is already covered; otherwise add `reminderOptOut: parsed.data.reminderOptOut`).

- [ ] **Step 3: In `src/app/api/customers/route.ts`** — add `reminderOptOut: customers.reminderOptOut` to the list `select({...})` so the customers list can mute opted-out rows.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/customers
git commit -m "feat(api): expose reminderOptOut on customer get/list/update"
```

---

## Task 6: Reminders Control Center tab + management page + i18n

**Files:**
- Modify: `src/components/ui/ControlCenterTabs.tsx`
- Modify: `src/lib/i18n.ts` (all reminder strings, added here once)
- Create: `src/app/miniapp/settings/reminders/page.tsx`

- [ ] **Step 1: Add the tab** — in `src/components/ui/ControlCenterTabs.tsx`, extend the `tabs` array:

```ts
const tabs = [
  { href: '/miniapp/settings/catalog', label: 'קטלוג' },
  { href: '/miniapp/settings/reminders', label: 'תזכורות' },
  { href: '/miniapp/settings', label: 'הגדרות' },
];
```

(The existing `isActive` already does `startsWith(href)` for non-root tabs, so `/miniapp/settings/reminders` highlights correctly. `/miniapp/settings` stays exact-match.)

- [ ] **Step 2: Add all reminder i18n keys** — in `src/lib/i18n.ts`, after the `'form.additions'` line (≈line 150), add:

```ts
  // Reminders
  'reminders.title': 'תזכורות',
  'reminders.subtitle': 'הודעות תזכורת ללקוחות בוואטסאפ',
  'reminders.occasion.week_start': 'תחילת שבוע',
  'reminders.occasion.shabbat': 'שבת',
  'reminders.add_template': 'תבנית חדשה',
  'reminders.label': 'שם לזיהוי',
  'reminders.meta_name': 'שם התבנית בוואטסאפ',
  'reminders.meta_name_hint': 'חייב להתאים בדיוק לתבנית המאושרת ב-Meta',
  'reminders.preview': 'תצוגת ההודעה',
  'reminders.occasion': 'מתי',
  'reminders.no_templates': 'אין תבניות עדיין',
  'reminders.template_saved': 'התבנית נשמרה',
  'reminders.template_deleted': 'התבנית נמחקה',
  'reminders.delete_has_history': 'לתבנית יש היסטוריית שליחה — השהה/י במקום למחוק',
  'reminders.send': 'שלח תזכורת',
  'reminders.send_to': 'שליחת תזכורת',
  'reminders.choose_occasion': 'בחר/י מועד',
  'reminders.confirm_count': 'שליחת {n} תזכורות',
  'reminders.sent_result': 'נשלחו {sent} · נכשלו {failed} · חסומים {skipped}',
  'reminders.no_active_for_occasion': 'אין תבניות פעילות למועד הזה',
  'reminders.opt_out': 'לא לשלוח תזכורות',
  'reminders.opt_out_on': 'הלקוח חסום לתזכורות',
  'reminders.select': 'בחירה',
  'reminders.selected_count': 'נבחרו {n}',
  'reminders.cancel': 'ביטול',
  'reminders.save': 'שמור',
```

(If a helper for `{n}`-interpolation doesn't exist, do `t('reminders.confirm_count').replace('{n}', String(n))` at call sites.)

- [ ] **Step 3: Build the management page** — `src/app/miniapp/settings/reminders/page.tsx`. Mirror the catalog page's conventions: `useApi`, `useGroup`, `useT`, `useToast`; baker guard; DOCKET docket-strip rows; a full-screen overlay editor like the catalog bread editor. Group templates by occasion. Each row: label, occasion chip, preview, active pause/play toggle, edit, delete.

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { Input, TextArea } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ControlCenterTabs } from '@/components/ui/ControlCenterTabs';
import { Plus, Pencil, Trash2, Pause, Play } from 'lucide-react';

type Occasion = 'week_start' | 'shabbat';
interface Template {
  id: number;
  label: string;
  metaTemplateName: string;
  occasion: Occasion;
  bodyPreview: string | null;
  isActive: boolean;
  sortOrder: number;
}

const OCCASIONS: Occasion[] = ['week_start', 'shabbat'];

export default function RemindersPage() {
  const { apiFetch } = useApi();
  const { activeGroupRole } = useGroup();
  const t = useT();
  const toast = useToast();
  const isBaker = activeGroupRole === 'baker';

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ templates: Template[] }>('/reminder-templates')
      .then((r) => setTemplates(r.templates))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (!editing?.label?.trim() || !editing?.metaTemplateName?.trim() || !editing?.occasion) return;
    setSaving(true);
    try {
      const payload = {
        label: editing.label.trim(),
        metaTemplateName: editing.metaTemplateName.trim(),
        occasion: editing.occasion,
        bodyPreview: editing.bodyPreview?.trim() || null,
        isActive: editing.isActive ?? true,
      };
      if (editing.id) {
        const { template } = await apiFetch<{ template: Template }>(`/reminder-templates/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setTemplates((prev) => prev.map((x) => (x.id === template.id ? template : x)));
      } else {
        const { template } = await apiFetch<{ template: Template }>('/reminder-templates', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setTemplates((prev) => [...prev, template]);
      }
      toast.success(t('reminders.template_saved'));
      setEditing(null);
    } catch {
      toast.error(t('reminders.template_saved')); // replaced below by a failure key if desired
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(tpl: Template) {
    const { template } = await apiFetch<{ template: Template }>(`/reminder-templates/${tpl.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !tpl.isActive }),
    });
    setTemplates((prev) => prev.map((x) => (x.id === template.id ? template : x)));
  }

  async function remove(tpl: Template) {
    try {
      await apiFetch(`/reminder-templates/${tpl.id}`, { method: 'DELETE' });
      setTemplates((prev) => prev.filter((x) => x.id !== tpl.id));
      toast.success(t('reminders.template_deleted'));
    } catch {
      toast.error(t('reminders.delete_has_history'));
    }
  }

  if (isBaker) {
    return (
      <>
        <PageHeader title={t('reminders.title')} />
        <ControlCenterTabs />
        <div className="p-5 text-sm text-muted-foreground">—</div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('reminders.title')} />
      <ControlCenterTabs />
      <div className="p-5 space-y-4">
        {OCCASIONS.map((occ) => {
          const rows = templates.filter((tp) => tp.occasion === occ);
          return (
            <Card key={occ} className="p-0 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-dashed border-border">
                <span className="font-semibold text-sm">{t(`reminders.occasion.${occ}`)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing({ occasion: occ, isActive: true })}
                >
                  <Plus className="h-4 w-4" />
                  {t('reminders.add_template')}
                </Button>
              </div>
              {rows.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground italic">{t('reminders.no_templates')}</p>
              ) : (
                rows.map((tp) => (
                  <div key={tp.id} className="flex items-start gap-2 px-4 py-3 border-t border-dashed border-border first:border-t-0">
                    <div className="flex-1 min-w-0">
                      <div className={tp.isActive ? 'font-medium' : 'font-medium opacity-50'}>{tp.label}</div>
                      <div className="font-mono text-[11px] text-muted-foreground truncate">{tp.metaTemplateName}</div>
                      {tp.bodyPreview && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tp.bodyPreview}</div>}
                    </div>
                    <button type="button" aria-label="toggle" className="p-1.5 text-muted-foreground hover:text-foreground" onClick={() => toggleActive(tp)}>
                      {tp.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </button>
                    <button type="button" aria-label="edit" className="p-1.5 text-muted-foreground hover:text-foreground" onClick={() => setEditing(tp)}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="delete" className="p-1.5 text-destructive/70 hover:text-destructive" onClick={() => remove(tp)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </Card>
          );
        })}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-background p-5 overflow-y-auto">
          <div className="space-y-4 max-w-md mx-auto">
            <h2 className="text-lg font-semibold">{t('reminders.send_to')}</h2>
            <Input label={t('reminders.label')} value={editing.label ?? ''} onChange={(e) => setEditing((p) => ({ ...p!, label: e.target.value }))} />
            <Input label={t('reminders.meta_name')} value={editing.metaTemplateName ?? ''} onChange={(e) => setEditing((p) => ({ ...p!, metaTemplateName: e.target.value }))} />
            <p className="text-xs text-muted-foreground -mt-2">{t('reminders.meta_name_hint')}</p>
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1.5">{t('reminders.occasion')}</div>
              <div className="flex gap-2">
                {OCCASIONS.map((occ) => (
                  <button
                    key={occ}
                    type="button"
                    className={
                      'flex-1 rounded-lg border px-3 py-2 text-sm font-medium ' +
                      (editing.occasion === occ ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-muted-foreground')
                    }
                    onClick={() => setEditing((p) => ({ ...p!, occasion: occ }))}
                  >
                    {t(`reminders.occasion.${occ}`)}
                  </button>
                ))}
              </div>
            </div>
            <TextArea label={t('reminders.preview')} value={editing.bodyPreview ?? ''} onChange={(e) => setEditing((p) => ({ ...p!, bodyPreview: e.target.value }))} />
            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={save} loading={saving} disabled={!editing.label?.trim() || !editing.metaTemplateName?.trim() || !editing.occasion}>
                {t('reminders.save')}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>{t('reminders.cancel')}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

> Before finalizing, open `src/app/miniapp/settings/catalog/page.tsx` and confirm `PageHeader`, `Card`, `Button`, `Input`/`TextArea`, `useToast`, `useT`, `ControlCenterTabs` import paths match (they do as of this writing). Replace the `toast.error` placeholder in `save()` with a real failure key if you want a distinct message; a generic catch is acceptable for v1.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Visual check** — build a `/tmp/mockups/reminders-admin.html` harness (DOCKET light tokens, RTL) showing the two occasion cards with a couple of template rows + the overlay editor; render with the established headless-Chrome command; eyeball for clipping/RTL.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/ControlCenterTabs.tsx src/lib/i18n.ts src/app/miniapp/settings/reminders
git commit -m "feat(reminders): template management tab + page"
```

---

## Task 7: Customer profile — opt-out toggle + send actions

**Files:**
- Create: `src/components/ui/SendReminderSheet.tsx`
- Modify: `src/app/miniapp/customers/[id]/page.tsx`

- [ ] **Step 1: Build the reusable send sheet** — `src/components/ui/SendReminderSheet.tsx`. It picks an occasion, shows the count, calls `/reminders/send`, and reports the result. Caller passes either `customerIds` or `phoneId`.

```tsx
'use client';

import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';

type Occasion = 'week_start' | 'shabbat';

interface Props {
  count: number; // recipients shown in the confirm label
  customerIds?: number[];
  phoneId?: number;
  onClose: () => void;
  onSent?: () => void;
}

export function SendReminderSheet({ count, customerIds, phoneId, onClose, onSent }: Props) {
  const { apiFetch } = useApi();
  const t = useT();
  const toast = useToast();
  const [occasion, setOccasion] = useState<Occasion | null>(null);
  const [sending, setSending] = useState(false);

  async function send() {
    if (!occasion) return;
    setSending(true);
    try {
      const res = await apiFetch<{ sent: number; failed: number; skippedOptOut: number }>('/reminders/send', {
        method: 'POST',
        body: JSON.stringify({ occasion, customerIds, phoneId }),
      });
      toast.success(
        t('reminders.sent_result')
          .replace('{sent}', String(res.sent))
          .replace('{failed}', String(res.failed))
          .replace('{skipped}', String(res.skippedOptOut))
      );
      onSent?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('reminders.no_active_for_occasion'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-card p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">{t('reminders.send_to')}</h3>
        <div>
          <div className="text-sm text-muted-foreground mb-1.5">{t('reminders.choose_occasion')}</div>
          <div className="flex gap-2">
            {(['week_start', 'shabbat'] as Occasion[]).map((occ) => (
              <button
                key={occ}
                type="button"
                className={
                  'flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium ' +
                  (occasion === occ ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-muted-foreground')
                }
                onClick={() => setOccasion(occ)}
              >
                {t(`reminders.occasion.${occ}`)}
              </button>
            ))}
          </div>
        </div>
        <Button className="w-full" disabled={!occasion} loading={sending} onClick={send}>
          {t('reminders.confirm_count').replace('{n}', String(count))}
        </Button>
        <Button variant="ghost" className="w-full" onClick={onClose}>{t('reminders.cancel')}</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into the profile** — `src/app/miniapp/customers/[id]/page.tsx`. First locate the anchors:

Run: `grep -n "reminderOptOut\|send-contact\|sendContactCard\|interface Customer\|phones\b\|PageHeader\|useState" src/app/miniapp/customers/[id]/page.tsx`

Then:
1. Add `reminderOptOut?: boolean` to the page's customer type and read it from the GET response into state.
2. Import `SendReminderSheet` and add `const [showSend, setShowSend] = useState<{ customerIds?: number[]; phoneId?: number; count: number } | null>(null);`.
3. In the profile header actions (next to the existing "send contact" control), add a "send reminder" button (gated to non-bakers) that opens `setShowSend({ customerIds: [customer.id], count: 1 })`. If `customer.reminderOptOut`, show it disabled with the `reminders.opt_out_on` hint instead.
4. On each phone row, add a small "send reminder to this number" action → `setShowSend({ phoneId: p.id, count: 1 })`.
5. Add an opt-out toggle (a labeled checkbox using `reminders.opt_out`) that PATCHes `/customers/${id}` with `{ reminderOptOut: next }` and updates local state.
6. Render `{showSend && <SendReminderSheet {...showSend} onClose={() => setShowSend(null)} />}` at the end.

Concrete opt-out handler to add:

```tsx
async function toggleOptOut(next: boolean) {
  await apiFetch(`/customers/${customer.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ reminderOptOut: next }),
  });
  setCustomer((prev) => (prev ? { ...prev, reminderOptOut: next } : prev));
}
```

(Adapt `setCustomer`/state names to whatever the file already uses.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Visual check** — harness the profile header with the new send button + opt-out toggle + a phone row send action (DOCKET light, RTL); render + eyeball.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/SendReminderSheet.tsx "src/app/miniapp/customers/[id]/page.tsx"
git commit -m "feat(reminders): per-customer/per-phone send + opt-out toggle on profile"
```

---

## Task 8: Customers list — multi-select bulk send

**Files:**
- Modify: `src/app/miniapp/customers/page.tsx`

- [ ] **Step 1: Locate anchors**

Run: `grep -n "reminderOptOut\|interface Customer\|\.map(\|DocketStub\|useState\|PageHeader\|isBaker\|activeGroupRole" src/app/miniapp/customers/page.tsx`

- [ ] **Step 2: Add multi-select + bulk send.** Mirror the existing list styling (docket strips). Add:
1. `reminderOptOut?: boolean` to the customer type; read from the list GET.
2. State: `const [selectMode, setSelectMode] = useState(false); const [selected, setSelected] = useState<Set<number>>(new Set()); const [showSend, setShowSend] = useState(false);` and `isAdmin` from `activeGroupRole`.
3. A "בחירה" (select) action in the header (admins only) that toggles `selectMode`. In select mode, each row shows a checkbox; opted-out rows are rendered muted and are NOT selectable (skip toggling for them).
4. A sticky footer in select mode: "נבחרו {n}" + a "שלח תזכורת" button (disabled when `selected.size === 0`) that opens the sheet.
5. Render `{showSend && <SendReminderSheet customerIds={[...selected]} count={selected.size} onClose={() => setShowSend(false)} onSent={() => { setSelectMode(false); setSelected(new Set()); }} />}`.

Selection toggle helper:

```tsx
function toggleSelect(id: number, optOut?: boolean) {
  if (optOut) return; // opted-out customers can't be selected
  setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Visual check** — harness the list in select mode (checkboxes, one muted opted-out row, the sticky "נבחרו N / שלח תזכורת" footer); render + eyeball.

- [ ] **Step 5: Commit**

```bash
git add src/app/miniapp/customers/page.tsx
git commit -m "feat(reminders): multi-select bulk send on customers list"
```

---

## Task 9: Final integration pass + docs

- [ ] **Step 1: Full type-check + build sanity**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Env check** — confirm `.env.example` documents `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID` (already used by `sendWhatsAppTemplate`). The removed `WHATSAPP_REMINDER_TEMPLATE` single-template var is no longer needed (templates now live in the DB). If `.env.example` still lists it, remove it.

- [ ] **Step 3: Update the spec status** — mark `docs/superpowers/specs/2026-06-17-customer-reminders-design.md` status as "Implemented" (leave the out-of-scope/future section intact).

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: Manual smoke test (deployed)** — register two `shabbat` Meta templates in Meta Business Manager, add them in the תזכורות tab with matching names; send to one customer twice and confirm the variant rotates; toggle opt-out and confirm they're skipped (result toast shows `skipped 1`); send to a multi-selected set; verify rows appear in `reminder_sends`.

---

## Self-Review

**Spec coverage:**
- Manual trigger only → Tasks 7–8 (no cron anywhere). ✓
- Per-phone / per-customer / multi-select → Task 7 (phoneId + customerIds), Task 8 (multi-select). ✓
- Occasion-tagged, several per occasion, auto-rotated → Tasks 1, 2, 4, 6. ✓
- Round-robin by sortOrder from last send → `pickNextTemplate` (Task 2) + per-customer resolution (Task 4). ✓
- Send log → `reminder_sends` (Task 1) written in Task 4. ✓
- Manual admin opt-out flag, no webhook → `reminderOptOut` (Task 1), API (Task 5), UI toggle (Task 7), skip logic (Task 4), muted/non-selectable in list (Task 8). ✓
- Owner/manager only, bakers excluded → role checks in Tasks 3, 4 (API) and baker guards in Tasks 6, 7, 8 (UI). ✓
- App as launcher over Meta templates (no free text) → `metaTemplateName` stored + sent via `sendWhatsAppTemplate`; `bodyPreview` is display-only. ✓
- New Control Center "תזכורות" tab → Task 6. ✓
- Confirm sheet shows count, each send costs → `SendReminderSheet` confirm label (Task 7). ✓
- Out of scope (cron, inbound opt-out webhook, Meta auto-sync, cost estimate) → not implemented, preserved in spec. ✓

**Placeholder scan:** No "TBD/TODO". The one soft spot is the `toast.error` in Task 6 `save()` reusing the success key — flagged inline as acceptable for v1 / replaceable with a failure key. UI edit tasks (5, 7, 8) intentionally use grep-anchored instructions instead of fixed line numbers because those files changed recently and line numbers would be stale; all new code (handlers, components, JSX snippets) is provided in full.

**Type consistency:** `Occasion` = `'week_start' | 'shabbat'` everywhere (schema enum, zod `z.enum`, client types). `pickNextTemplate(templates, lastTemplateId)` signature matches its Task-4 call. `sendWhatsAppTemplate(to, name, 'he', [firstName])` matches the real signature. `/reminders/send` body `{ occasion, customerIds?, phoneId? }` matches `SendReminderSheet` and both callers. `reminderOptOut` (camel) ↔ `reminder_opt_out` (snake) consistent with drizzle column mapping. Send result `{ sent, failed, skippedOptOut }` matches the sheet's interpolation keys.
