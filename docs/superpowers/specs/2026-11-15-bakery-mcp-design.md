# Bakery MCP — design

Status: approved by the owner 2026-11-15.

## Why

The owner and their wife want a Telegram group chat with Claude for sourdough talk. They don't want generic advice; they want answers about *their* breads. An example question: "how do freezing and baking work for each type of bread we have". The owner builds that bot in a separate repo. This app gives it a way to look at the bakery: an **MCP server**, the standard plug-in that lets Claude call an app's tools.

The owner also wants the bot to **change recipes and prices on its advice**. The model is "ask the bot, approve the change and voila", with no manual editing. But nothing may change until the owner presses an approve button. Only the owner can approve, because the wife "can click without reading".

The app holds no baking or freezing instructions. For questions like the example, Claude combines the recipes it reads here with its own sourdough knowledge. This is understood and accepted.

## Scope

**This repo builds** the MCP server, the approve endpoint, the proposals store, and a settings card for the key.

**The owner builds the group bot** in their spouse repo. When this ships, they get step-by-step connection instructions.

Per bakery, owner's words: everything is per bakery (`groups` row) and works the same for any bakery the app hosts.

## What Claude can read (tools)

All reads are scoped to the bakery the key belongs to. Each one reuses the app's existing loaders, so the numbers match the mini app.

| Tool | Returns | Built on |
|---|---|---|
| `list_breads` | Every bread with id, name, description, active flag. Its sizes come with id, name, weight, the size's own price, the bread's override if any, and the price that applies. Quantity deals, both the size-wide ones and the bread's own. Additions and the additions surcharge. | `loadBreadMenu`, plus the raw size, override and tier rows so base and override are distinguishable. Inactive breads and sizes are included and marked, so a proposal can name them. |
| `get_recipes` | For every bread that has a recipe, or for one bread: ingredients (name, kind, % of finished loaf, baker's %), hydration, and the recipe's last-change time. | `loadBreadsForCosting` and `withBakersPercents` from `src/lib/recipe.ts`. |
| `get_ingredient_prices` | ₪/kg per ingredient (name, kind), the starter settings (flour, hydration, waste factor), and the ingredients in use that have no price. | `loadPriceRows`, `loadPriceBook`, `loadIngredientsInUse`. |
| `get_loaf_costs` | Per bread and size: ingredient cost per loaf, cost per kg, the selling price that applies, the margin (price − cost, and % of price), and the ingredients missing a price (cost then marked incomplete, never treated as 0). | `scaleRecipe` and `costScaledRecipe` from `src/lib/cost.ts` with `loadPriceBook`, the same maths as the loaf cost calculator. |
| `get_sales` | For a year (default: this one, Israel calendar): units sold per bread and size per month, and per-month order count, units and ₪ billed. | `buildIncomeReport(groupId, year)`, its `breads` and `months`. |

- **Not exposed, owner's call:** customers (names, phones, addresses, debts), individual orders, payments per person, and the kitchen's "what to bake" counts (the owner: already on the screen, excessive in the MCP).
- **Sales are units, not ₪ per bread (my call).** Bulk deals, mixed packs and order-total overrides make ₪ per bread only approximate. The income report has units per bread and ₪ per month, so that's what Claude gets.

## What Claude can propose (tools)

A propose tool **never changes anything**. It checks the proposal with the same validation the mini app's save uses, then stores it as pending. It returns a proposal id plus the Hebrew text of the change as the app will apply it. An invalid proposal returns the validation message to Claude, so it can correct itself, and nothing is stored.

| Tool | Changes, on approval |
|---|---|
| `propose_recipe` | One bread's whole ingredient list: amounts, ingredients added or removed. Input is the same as the recipe sheet's save: rows of name, kind and % of finished loaf, or grams plus a reference weight. |
| `propose_size_price` | A size's own price (`bread_sizes.price`), which applies to every bread without an override. |
| `propose_bread_price` | One bread's price for one size (`bread_type_sizes.price_override`), or removing the override. The bread must already offer that size; proposing never adds a size to a bread. |
| `propose_deal` | A quantity deal for a size: either size-wide or for one bread. Set or change its price, or remove it. |
| `propose_ingredient_price` | One ingredient's ₪/kg. Only that row changes; the rest of the price list and the starter settings don't. |

- **One proposal is one change** (owner agreed), and the owner approves each separately.
- **Out of reach entirely:** adding, renaming, hiding or deleting breads, sizes or additions; descriptions and the public site; the additions surcharge and starter settings; anything about customers, orders or money.
- Proposal tool descriptions tell Claude to propose only what the user asked for or agreed to in the chat. This is only guidance. The real guard is the approval below.

## Approving

Flow (owner agreed):

1. Claude calls a propose tool. The app stores a pending proposal and returns its id and Hebrew summary.
2. The family bot finds the proposal id in Claude's tool results and fetches `GET /api/mcp/proposals/{id}` with the bakery key. It posts a card in the group showing **the app's own summary text** (not Claude's wording), with אשר and בטל buttons. Showing the app's text guarantees the card describes exactly what would be applied.
3. Someone presses a button. Telegram's `callback_query.from.id` identifies the person who pressed, and the presser can't fake it.
4. The family bot's button code calls `POST /api/mcp/proposals/{id}/decision` with the bakery key and `{ telegramUserId, decision: 'approve' | 'reject' }`.
5. The app finds that Telegram account's member row in the proposal's bakery. If the role is **owner**, it applies or rejects. Anyone else gets 403 with a Hebrew reason the bot can show ("רק הבעלים יכול לאשר שינויים"). That covers other roles and accounts the app doesn't know.
   - **Lookup:** `telegramUserId` → `users.telegram_id` (stored as a string) → `group_members` row for the proposal's `group_id` → role.
   - **Several bakeries:** if the person belongs to more than one, only their row in the proposal's bakery counts.
   - **The role is the rule (owner confirmed):** the wife isn't an owner, so checking for the owner role is enough. A bakery can have more than one owner, and each of them can approve.

**Safeguards:**
- **Approving is not an MCP tool.** Claude's tool list has no way to approve or reject, so Claude can propose and never approve. The decision endpoint is a plain HTTP route outside the MCP server.
- **The owner check is made here,** from the app's own member list. The other repo can't decide it.
- **Remaining trust (accepted):** the app believes the family bot about who pressed the button. Both bots are the owner's. If the key leaked, someone could approve or reject pending proposals and create new ones, but only for this bakery's recipes and prices.

**Rules on approval:**
- **Stale check:** each proposal stores the "before" values it was made from. At approval, the current values are compared with them. If anything changed in the meantime, the approval is refused as stale ("השתנה מאז ההצעה — בקשו הצעה חדשה") and nothing changes. (My call: compare values, not timestamps. Three of the five tables have no `updated_at`, and comparing values covers all five the same way.)
  - **Only the touched values are compared (my call):**
    - **A recipe** compares its ingredient set (name, kind, % of finished loaf), ignoring row order.
    - **A price, override or ingredient ₪/kg** compares that one value.
    - **A deal** compares its price.
    - **A row that didn't exist** is recorded as absent, and it's still stale if it now exists. The same applies the other way: a row that existed but has since been removed or renamed is stale.
    - Nothing else counts, so a changed bread description doesn't make a price proposal stale.
  - **Two proposals for the same thing (my call):** whichever is approved first applies, and the other then fails the stale check. No extra handling is needed.
- **Applying uses the mini app's own save code** (one code path). The save logic lives inline in each route today, so it's extracted into lib functions that both the route and the approve endpoint call:
  - `saveRecipe`;
  - `setSizePrice`;
  - `setBreadSizePriceOverride` (new, narrow: one row, no delete and re-insert, so badges and order are kept);
  - `upsertTier` and `deleteTier`;
  - `upsertIngredientPrice` (new, narrow: no prune, no starter change).

  The existing routes switch to these with no behaviour change. Price changes call `revalidatePublicSite`. The kitchen screen refreshes on its own through the write hook.
- **Single use:** pending → applied, rejected, expired or failed happens once, through an atomic `UPDATE ... WHERE status='pending'`. A double click, or a second click from someone else, gets "already decided".
- **Expiry (my call):** a proposal not decided within 7 days becomes expired, checked when it's read or decided. No cron.
- **Existing orders never change.** Orders freeze their price when saved, so a new price only affects new orders and the public price list.

## The proposals store (doubles as the change log)

New table `change_proposals`:
- `id` and `group_id`;
- `kind`: recipe, size_price, bread_price, deal or ingredient_price;
- `target` (jsonb ids), `before` (jsonb), `after` (jsonb), and `summary_he` (text);
- `status`: pending, applied, rejected, expired, stale or failed;
- `created_at` and `expires_at`;
- `decided_by_user_id` (users.id), `decided_at`, and `error` (text, why it failed or was stale; for logs, not shown).

It's the audit trail the owner asked for: what changed, when, and who approved it. It's never pruned (my call; it's tiny).

## The key

- **One key per bakery** (owner agreed). It's used both as the MCP bearer token and for the decision endpoint.
- **Format:** a random 32-byte key, base64url, prefixed `bmcp_` so it's recognisable if it leaks into a log or a chat. Only its SHA-256 hash is stored, on `groups` (`mcp_key_hash`, `mcp_key_created_at`), following the kitchen pairing code. The key is shown once when created.
- **Requests** send `Authorization: Bearer <key>`. The app hashes it and looks up the bakery. No match: 401.
  - The app has no middleware or proxy that gates `/api`; each route does its own authentication.
  - `/api/mcp` and `/api/mcp/proposals/*` use this key check instead of Telegram init-data.
- **Kitchen refreshes (my call):** storing a proposal goes through the same database client, so the write hook marks the kitchen copy stale. The cost is one cheap extra re-read on the kitchen screen, which is accepted rather than adding an exception to the hook.
- **Settings card** "חיבור לבוט AI", visible to the owner only (my call; the key can create proposals):
  - **Create key:** shows it once, with a copy button and a "save it now" warning.
  - **Replace key:** the old one stops working immediately.
  - **Disconnect:** no key.
  - It shows the key's creation date and the MCP address to paste into the bot.
- **The settings API** is owner-only and follows the kitchen pairing route's shape: POST issues, DELETE revokes.

## Server and transport

- **Endpoint:** `/api/mcp`, MCP over Streamable HTTP, stateless (no sessions). This is what the Claude API's MCP connector calls.
- **Library:** Vercel's `mcp-handler` 2.x, with `@modelcontextprotocol/server` 2.x, the current TypeScript SDK line.
  - Neither has a stated compatibility note for Next 16. The builder confirms it in the build.
  - If it doesn't work, the fallback is a plain route handler using the SDK's stateless Streamable HTTP transport.
  - The bearer check is done by us either way, following the mcp-handler auth docs where they fit.
- **Tool inputs** are validated with zod/v4, which the repo already uses.
- **Tool results** are compact JSON with ids and Hebrew names, plus money as decimal strings (`"32.00"`), as the app stores it.
- **Language:** tool descriptions are in English for the model. Every user-facing text (proposal summaries, refusal reasons) is in Hebrew through `src/lib/i18n.ts`.
- **Logging:** `[mcp]` per call (group id, tool, ms, outcome) and `[mcp-decision]` per decision (proposal id, group, kind, decision, result). Never key material; never recipe or price contents beyond ids.

## Connecting (delivered to the owner when shipped)

- **The family bot** passes on each Messages API request:
  - `mcp_servers: [{ type: 'url', url: 'https://www.razeilechem.co.il/api/mcp', name: 'bakery', authorization_token: <key> }]`;
  - an `mcp_toolset` for `bakery`;
  - the MCP connector beta header.

  It can enable or disable tools per conversation or topic, which answers "another MCP for another conversation".
- **Card and button handling** lives in the family bot: it finds proposal ids in the tool results, fetches the summary, posts the card, and sends the decision. The owner gets exact request examples for this.
- **Using it from the Claude app directly** isn't in scope. That needs OAuth, or the `static_headers` connector beta, which is limited to some organisations.

## Non-goals

- No customers, orders, payments or kitchen counts through the MCP.
- No creating, renaming or deleting breads, sizes or additions.
- No approving inside the MCP, and no approving by anyone but the owner.
- No "list pending proposals" tool or screen (my call). The family bot always fetches a proposal by its id.
- No OAuth or Claude-app connector, no rate limiting, and no "last used" tracking. Recording use would be a database write on every call.
- No changes to the mini app's screens beyond the key card, and no refactor beyond extracting the save functions.

## Anti-goals

- **Any change applied without the owner's explicit approval.**
- **Claude being able to approve,** directly or by naming an account.
- **One bakery's key reading or changing another bakery's data.**
- **The approval card showing something different from what gets applied.**
- **A proposal silently overwriting an edit made in the app after it was proposed.**
- **Two save code paths** for the same thing (mini app vs approval).

## Left to the builder

- Exact tool names and input/output shapes within the tables above.
- How the propose tools reuse validation without writing.
- The Hebrew summary format.
- mcp-handler vs the bare SDK transport, decided by what builds on Next 16.
- Migration details, and the settings card layout, mirroring `KitchenScreenCard`.

## Verification (no test touches the owner's database, Telegram, Google or Anthropic)

- Offline `tsx` scripts in the scratchpad with a stubbed database layer:
  - key hashing and lookup;
  - each propose tool's validation;
  - the stale check per kind;
  - single-use decisions;
  - the owner-only check (owner, manager, baker, unknown account);
  - expiry.
- A local MCP round trip against a fake-DB build: list tools, call one read tool and one propose tool.
- Gate: `npx tsc --noEmit`, `pnpm exec eslint .`, `next build` with the fake Neon shim.
- **Not verifiable before deploy:** the real Claude API connector calling `/api/mcp`, and the family bot's card flow. The owner tests these manually.

## Addendum 2026-11-18: removing unused prices and home-made entries

The owner asked for the bot to clean up the ingredient lists.

- **`propose_ingredient_price` with `pricePerKg: null`** proposes removing that ingredient's price, the way `propose_deal` removes a deal.
  - It is allowed only for a price nothing uses: no recipe, and no home-made entry's flour or liquid. That is the same rule as the prices screen's "מחירים ללא רכיב תואם" list, the only prices that screen lets you delete. Removing the price of something in use would only make costs read "חסר מחיר".
  - Starter and tangzhong have no typed price, so this is refused for them, as before.
- **New tool `propose_remove_home_made_ingredient`** (`name`, `ingredientKind`): removes a home-made entry that no recipe uses (proposal kind `home_made`, after = null). An entry a recipe uses is removed on the catalogue screen, not by the bot.
- **Staleness:** a removal stores the values and the usage it was proposed against. If a recipe or home-made entry starts using the ingredient before approval, the approval is refused as stale.
- **Reads:** `get_ingredient_prices` gives each price and each home-made entry a `usedBy` list, so Claude can tell what may be removed.
