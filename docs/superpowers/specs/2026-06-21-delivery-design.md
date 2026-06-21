# Delivery + Driver Role — Design

**Date:** 2026-06-21
**Status:** Approved (brainstormed with owner)
**Topic:** Order delivery (zoned pricing, fees, Waze), a "deliveries today" view, and a new `driver` role — all admin-side (orders are created in-app).

---

## 1. Goal

Let the owner mark an order for delivery, charge the right fee automatically, navigate to the customer with one tap, and run the day's deliveries from one screen. Add a `driver` role for the future (the owner drives for now) that sees only deliveries and can collect cash on delivery. Bakers must **not** see delivery details — only the order and its status.

---

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Pricing | **Home city free · listed cities a flat fee · free when items subtotal ≥ ₪X · any other city = pickup by default but delivery can be flipped on with a typed one-off fee.** |
| Free-over threshold | Auto-applies to **listed** cities; a **manual-override** fee is whatever the owner types. |
| Fulfillment axis | Delivery is a new per-order flag, **orthogonal** to the existing delivery-*type* (weekly/shabbat/date/asap = *when*). |
| Address | Customer `address` = the navigable part; new `deliveryNotes` = entrance code / floor / apt; **Waze** opens with a text query (`waze.com/ul?q=<address, city>&navigate=yes`). |
| Money | The fee adds to the order total and rides into the existing one-click charge. |
| Deliveries view | "משלוחים היום" — address · Waze · notes · contact · **amount to collect** · status; mark **delivered** and **collect + mark paid** (COD). |
| Driver role | New `driver`: lands in the deliveries view (light theme, stripped nav), marks delivered + collects payment; sees the **per-order amount to collect**, not the customer's balance/history. |
| Status | Keep **ready → delivered** (no new status). |
| Bakers | See the order, its status, and a pickup/delivery **tag** — never address/notes/fee. Enforced **server-side**. |
| Scale | Single-driver now; structured for per-driver assignment later (not built). |
| Public site | Details section advertises the delivery terms. |

---

## 3. Data model

One migration adds the columns; a second adds the enum value (Postgres requires `ALTER TYPE … ADD VALUE` to stand alone).

### 3.1 `member_role` enum → add `driver`
`ALTER TYPE "member_role" ADD VALUE 'driver';` (migration `0014`, its own file). `GroupRole` in `src/hooks/useGroup.ts` extends to `'owner' | 'manager' | 'baker' | 'driver'`.

### 3.2 `groups` — delivery settings
| Column | Type | Notes |
|---|---|---|
| `delivery_enabled` | boolean default false | master switch (gates the order checkbox + public line) |
| `delivery_home_city` | varchar(255) | free-delivery city |
| `delivery_fee` | decimal(10,2) default '0' | flat fee for listed cities |
| `delivery_free_over` | decimal(10,2) nullable | free when items subtotal ≥ this |
| `delivery_cities` | jsonb (`string[]`) | listed (paid) cities |

### 3.3 `orders`
- `is_delivery` boolean default false
- `delivery_fee` decimal(10,2) default '0' — the **resolved** fee for this order (0 for home/free-over/pickup; flat or manual otherwise)

### 3.4 `customers`
- `delivery_notes` text — entrance code / floor / apt / instructions (never sent to Waze)

---

## 4. Fee logic

`src/lib/delivery.ts`:
- `normalizeCity(s)` — trim, collapse spaces, strip maqaf/hyphens, so "תל אביב" ≈ "תל-אביב".
- `suggestDelivery(city, settings)` → `{ isDelivery: boolean, fee: number, available: boolean, free: boolean }` computed **without** the subtotal (city classification): home → available+free; listed → available, fee=flat; else → not auto-available (manual override allowed).
- `resolveDeliveryFee({ city, subtotal, settings, manualFee })` → number: home → 0; listed → `subtotal >= freeOver ? 0 : flatFee`; unlisted → `manualFee` (typed).

The **order form** uses these to pre-fill the checkbox + suggested fee from the selected customer's city; the owner can override both. The stored `orders.delivery_fee` is the final number (server stores what's sent; only owner/manager create orders).

---

## 5. Money integration

The single chokepoint is **`calculateOrderTotal(orderId)`** in `src/lib/order-payments.ts` — used by both the display and `ensureOrderCharge`. Change:

```
total = (totalOverride ?? sum(items)) + Number(order.delivery_fee || 0)
```

(select `delivery_fee` in that query). Mirror the same `+ delivery_fee` in the inline computation in `GET /api/orders/[id]` so the detail view matches. Because `ensureOrderCharge` calls `calculateOrderTotal`, the charge — and therefore "amount to collect" — includes the fee automatically. The order detail + PaymentOptions render a **"משלוח"** line above the total.

---

## 6. Roles & permissions

### 6.1 The hardening (security-critical)
The codebase encodes "is admin" as **`role !== 'baker'`** (client) and gates management routes with **`role === 'baker'` → 403** (server). A naively-added `driver` would inherit owner/manager powers. So:

- **Server:** every management deny `if (membership.role === 'baker')` becomes `if (membership.role === 'baker' || membership.role === 'driver')`. Sweep all occurrences (invites, bread-types/sizes/additions/recipes, reminder-templates, reminders/send, media, group PATCH, orders POST/PATCH/DELETE/status/pay, customers POST/PATCH). Net effect: **drivers can manage nothing**; they only reach the new delivery endpoints.
- **Client:** `isAdmin = role !== 'baker'` → `isAdmin = role === 'owner' || role === 'manager'` (customers pages). Driver is not admin.
- **Theme:** dark condition → `role === 'owner' || role === 'manager'` (driver stays light).

### 6.2 Who sees what
| | Owner/Manager | Driver | Baker |
|---|---|---|---|
| Deliveries view (address/Waze/notes/amount) | ✓ | ✓ | ✗ |
| Mark delivered | ✓ | ✓ (delivery orders only) | ✗ |
| Collect + mark paid | ✓ | ✓ (delivery orders only) | ✗ |
| Customer balance/history | ✓ | ✗ | ✗ |
| Delivery/pickup tag + status on orders | ✓ | ✓ | ✓ |
| Catalog/customers/settings/site management | ✓ | ✗ | ✗ |

Driver pay/status are restricted server-side to `is_delivery` orders.

### 6.3 Invite
`role` enum on the invite API + the settings invite UI gain `driver` (alongside manager/baker); i18n `role.driver = 'שליח'`.

---

## 7. Address + Waze
- Customer detail: add a `deliveryNotes` input (edit) + display; a **"פתח ב-Waze"** button when address+city exist → `https://waze.com/ul?q=${encodeURIComponent(address + ', ' + city)}&navigate=yes`.
- The same Waze button appears per row in the deliveries view and on the order detail (for delivery orders).

---

## 8. Order form
A **"משלוח"** block in `orders/new` (and edit), inside/near the delivery-type card:
- A checkbox, auto-suggested from the selected customer's city (`suggestDelivery`). For an unlisted city: off by default, with a quiet "אין משלוח לעיר זו — אפשר לסמן ידני" note; flipping it on reveals a fee input.
- When on: show the computed fee (editable). Listed-city + subtotal ≥ free-over → shows ₪0 ("חינם").
- Payload gains `isDelivery` + `deliveryFee`; `createOrderSchema`/`updateOrderSchema` accept them.

---

## 9. Deliveries view
- `GET /api/deliveries?scope=today|upcoming` (owner/manager/driver): returns delivery orders (`is_delivery = true`, not cancelled) with customerName, address, city, deliveryNotes, phone, total (amount to collect), paid, status, deliveryDate — grouped reusing `groupByDeliveryDate`.
- Page `src/app/miniapp/deliveries/page.tsx`: per-row card — customer · address + **Waze** · notes · ₪amount · status; actions **"נמסר"** (PATCH status→delivered) and **"מסר ונגבה"** (status→delivered + record payment for the total via the pay route). Today first, then upcoming.
- A delivery/pickup **tag** is added to `DocketRow` (orders list + dashboard) via a new optional `isDelivery` prop; orders GET returns `isDelivery`.
- Dashboard: a compact "משלוחים היום" entry-point (count → links to the view) between the quick-actions and pending sections.

---

## 10. Driver experience
- **Nav:** `BottomNav` becomes role-aware — driver sees a single **משלוחים** tab; owner/manager/baker keep the current four (owner/manager reach deliveries from the dashboard entry-point).
- **Home:** `/miniapp` redirects `driver` → `/miniapp/deliveries`.
- **Theme:** light (front-of-house).
- **Onboarding:** a driver invited to an existing group lands straight in deliveries; no group-creation path changes.

---

## 11. Public site
`getPublicSite` reads the group's delivery settings; when `delivery_enabled`, the **details** section adds a row: *"משלוח חינם ב<homeCity> · ₪<fee> לערים נבחרות · חינם מעל ₪<freeOver>"* (omitting clauses that aren't set). View-model gains a `delivery` summary.

---

## 12. Out of scope (future)
- Per-driver assignment / multi-driver routing.
- Distance/geocoded pricing, delivery time windows, "out for delivery" status.
- One-off per-order delivery address (uses the customer's saved address).
- Failed-delivery handling, public-side checkout.

---

## 13. Implementation phases
1. **Schema + role** — group/order/customer columns (migration 0013-bis… actually `0014_delivery` + `0015_driver_role` for the enum); `GroupRole`; `src/lib/delivery.ts`.
2. **Settings + address/Waze** — bakery delivery settings UI; `deliveryNotes` + Waze on customer; i18n.
3. **Order integration + fee** — order-form delivery block; `createOrderSchema`/`updateOrderSchema`; `calculateOrderTotal` + GET detail include the fee; order-detail "משלוח" line; baker redaction holds (orders list already address-free).
4. **Deliveries view + driver role** — `/api/deliveries`; deliveries page; DocketRow tag; dashboard entry-point; driver role (enum value, nav, theme, home redirect, invite option); **the `=== 'baker'` → `baker||driver` server sweep + client `isAdmin` fix**; driver-restricted pay/status.
5. **Public terms + polish + push** — public details delivery line; full `tsc` + `next build`; screenshots; push; ping.

Verification: no test runner — gate on `npx tsc --noEmit`, `next build`, and headless-Chrome screenshots (public surfaces + key screens via mock-data preview routes).
