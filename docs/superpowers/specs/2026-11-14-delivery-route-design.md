# Delivery route order — design

Status: draft for the owner's approval (2026-11-15).

## Why

The owner delivers personally, typically about 3 stops in one run that starts and ends at home. Today they take all the orders and drive them one by one, choosing the order by eye, and navigate each stop with its Waze button on the deliveries screen. They want the app to look at the deliveries that are not yet delivered and suggest the order with the least driving.

## What it does

The deliveries screen (`/miniapp/deliveries`) shows the open deliveries as **one numbered list in route order**: the order with the least total driving time, from the bakery's home address, through every stop, and back home.

- **What's in the route (owner):** every undelivered delivery the screen already lists (`is_delivery`, status not delivered or cancelled), **whatever its date**, including בהקדם and overdue ones. A delivery dated next week joins today's route too. That's accepted; a date filter can come later if it bites.
- **There's no button (owner):** the route is worked out each time the screen opens.
- **It updates as you go (owner):** when a stop is marked delivered on this screen (נמסר or מסר ונגבה), the remaining stops re-sort, starting from the stop just delivered and ending at home. While the new order is being fetched, the list keeps the previous order minus the delivered stop, which is already a sensible order. *My call:* the "where am I" point is the delivered stop's address, not the phone's GPS. No location permission is asked for.
- **"Least driving" means driving time with no live traffic (my call).** Traffic-aware times cost more and are capped lower, and for a few local stops the order rarely changes.
- **Who sees it (owner):** the same people who see the deliveries screen today: the owner, managers and drivers. Bakers never see it, and the server already refuses them.
- **The homepage is untouched (owner, option A).** Its "משלוחים היום" button already opens this screen.

## The screen

```
 🚚 משלוחים היום
 ┌──────────────────────────────────────┐
 │  [ נווט את כל המסלול ב-Google Maps ]  │   ← one link, the whole remaining route
 └──────────────────────────────────────┘
  1 ─ כהן          רח׳ הזית 4, מושב X     ₪60
      [Waze] [WhatsApp]   [נמסר] [מסר ונגבה]
  2 ─ לוי    מחר    רח׳ ...                שולם
      ...
  3 ─ מזרחי  לבדוק כתובת  מושב Y           ₪45
      ...
 ── בלי כתובת ─────────────────────────────
  •  דוד   (no address or city: not in the route)
```

- The date groups give way to one list. Each card keeps everything it has today: name, address, the amount or "paid" badge, delivery notes, Waze, WhatsApp, נמסר and מסר ונגבה. It gains a **stop number**, a real sequence.
- A card whose date isn't today carries a small date tag, using the same wording the screen uses now: מחר, the date, or בהקדם. Without it, folding all dates into one route would hide the fact that a stop is for another day.
- **Google Maps link (my call):** one https link that drives the remaining route in order from the phone's current location (`https://www.google.com/maps/dir/?api=1&destination=…&waypoints=…|…&travelmode=driving&dir_action=navigate`, no `origin`). On a phone, Google allows at most 3 waypoints:
  - With 3 or fewer stops left, the link visits them all and ends at home.
  - With more, it covers the next 4: 3 waypoints, then the 4th stop as the destination, deliberately not home. The label then says it's the next 4 stops.

  Because the link re-forms after each delivery, pressing it again carries on. Stops go into the link as address text, the same text Waze gets, rough ones included. Stops under בלי כתובת are not in it.
- **Waze stays per stop** (a Waze link can hold only one destination), unchanged.

## Addresses

- Addresses are the customer's `address` + `city`, as now; orders hold no address.
- **Geocoding (my call):** each customer's address is looked up once with Google Geocoding (`language=he`, `region=il`). The coordinates are saved on the customer together with the exact text that was looked up, so a changed address is looked up again and an unchanged one never is.
  - **The one mechanism is a check on read.** The route endpoint compares the saved text with the customer's current address and city, and only looks up the ones missing or changed. It doesn't matter which screen or bot edited the address, so no save hooks are needed and there's no backfill.
  - **First open waits for the lookups.** They run inside the request, all at once, before the order is worked out. With a few stops that's about a second.
- **An address Google can only place roughly stays in the route.** This is an address where Google can't find the street or number and falls back to the town, e.g. a moshav with no street numbers. The stop sits at that rough point and shows a "לבדוק כתובת" tag (owner: "pick some generic solution").
  - *Rule (my call):* "rough" means the top result is a `partial_match`, or its `location_type` is `APPROXIMATE`.
- **No address and no city, or Google answers "no results":** the stop is left out of the route and listed after it under "בלי כתובת" (my call), with its buttons intact.
  - "No results" is saved against the text, so it isn't asked again until the address changes.
  - A Google error or quota answer is never saved. That stop is retried on the next open. Meanwhile the whole route falls back (see "When it fails").
- **Places are distinct by coordinates.** Several open orders for the same customer, or for two customers at the same point, are one place in the matrix. They're numbered as consecutive stops.

## Home

- **Home is a new delivery setting (my call):** a free-text home address in the settings' delivery section, next to the bakery city. Owner and managers can edit it, as with the other delivery settings.
- **Saving it never calls Google.** The text is saved as typed. It is geocoded lazily by the route endpoint, with the same check on read as a customer's address. If Google can't find it, the screen falls back with a hint that the home address wasn't found.
- **When it's empty, the screen still opens.** The open deliveries keep today's date-grouped list, with a one-line hint to set the home address. For a driver the hint says to ask the manager, since a driver can't open settings.

## Working out the order

- **Driving times (my call):** one Google Routes API Compute Route Matrix request per computation, between home and the distinct stop locations, driving, without traffic (the "Essentials" tier). The matrix is directed, because A→B can differ from B→A on one-way streets.
- **Solving:** the builder picks the method.
  - For small runs (up to about 8 stops), try every order; that's exact and instant.
  - For more stops, use an exact dynamic-programming method or a good heuristic (nearest neighbour plus 2-opt), with a stated ceiling.
  - One matrix request allows at most 625 pairs, which means home plus 24 distinct places. Beyond that the route isn't computed, and the screen shows the same fallback as a Google failure.
- **Server side.** The Google key never reaches the browser. A new endpoint (e.g. `GET /api/deliveries/route?from=<orderId>`) takes the same role check as `/api/deliveries` and the same list of stops, and returns the order plus each stop's flags (rough, left out).
- **`from` names the stop just delivered.** The start point is that order's customer location. `from` is honoured only when the order is in this group, is a delivery, and is delivered.
- **Otherwise the route starts at home.** That covers a bad `from`, no `from` at all, and a delivered stop with no usable coordinates. A rough point counts as usable.
- **Nothing is stored about the route itself.** It's worked out on demand each time.
  - *Limit:* reopening the screen mid-run starts again from home.
  - *Limit:* a stop marked delivered elsewhere (e.g. from the order page) re-sorts only on the next open.
- **When it fails, the list still shows.** If Google fails, the key is missing or the quota is hit, the screen falls back to today's date-grouped list with a one-line note that the route couldn't be worked out. The error is logged with a `[delivery-route]` tag and the status and reason, never silently.
- **Logging for prod debugging:** stop count, how many were geocoded fresh, how many are rough or left out, and matrix size. Never addresses or names in the logs.

## Cost

A run of n distinct places costs (n+1)² matrix elements; 3 stops is 16 and 8 stops is 81. A few runs a week with a re-sort after each stop stays far inside the free monthly allowance: 10,000 matrix elements and 10,000 geocodes. Expected cost: ₪0.

## Setup the owner does once

In Google Cloud:
1. Enable the Geocoding API and the Routes API.
2. Create an API key restricted to those two APIs.
3. Add it to Vercel as `GOOGLE_MAPS_API_KEY` (server-only, not `NEXT_PUBLIC_`).

Step-by-step instructions with exact values come at build time. Until the key exists, the screen behaves as in the failure case above.

## Data changes (migration 0034)

- `customers`: latitude, longitude, the geocoded text, and a "rough" flag.
- `groups`: the home address text, plus its latitude, longitude, geocoded text and rough flag.

## Non-goals

- No change to the homepage, the print sheet, or the kitchen screen.
- No live traffic, delivery time windows, multiple drivers or vehicles, or a map view.
- No GPS or location permission.
- No saved or shared route.
- No date filter on which deliveries join the route.

## Anti-goals

- **Hiding a delivery.** Every open delivery stays on the screen, in the route or under בלי כתובת.
- **Losing what the screen already does.** That covers collecting, the paid badge, notes, WhatsApp and Waze, plus the existing retry safety of "delivered, but the payment failed".
- **Exposing the Google key** to the browser.
- **Re-geocoding unchanged addresses** on every open.

## Left to the builder

- The solver method above 8 stops.
- Endpoint shape and naming.
- Column names.
- Exact Hebrew wording, through `src/lib/i18n.ts`, reading natively.
- Visual details of the stop number and tags, mirroring the screen's existing tokens. Mockup shown in chat before building.
