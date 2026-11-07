/**
 * The kitchen screen's look, appended after SHEET_CSS. It is the packing sheet
 * seen from a phone propped 1-2 m away, not a new design: same paper/ink
 * tokens, stub, mono numerals and stamp. What changes is scale (fluid width,
 * bigger type), one sticky day band in the stamp colour so she always knows
 * which day she is reading, and no pencil marks (nothing here is ticked).
 *
 * Overrides are scoped with `.kitchen` so the print sheet itself is untouched.
 * Dark mode redefines the tokens and the grounds only.
 */
export const KITCHEN_CSS = `
:root {
  --ground: #EFEBE2;
  --paper: #fff;
  --stub: #FAF8F4;
  --on-stamp: #FBF8F2;
  --wax: #FBF7EE;
  --wax-edge: #D9CFBD;
  --metal: #8C8374;
  --flame: #F2A43A;
  --flame-core: #FFF3C9;
  --glow: rgba(242, 164, 58, .22);
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground: #15120E;
    --paper: #1F1B16;
    --stub: #28231B;
    --ink: #F2EDE2;
    --ink-soft: #BDB4A3;
    --rule: #4D4638;
    --stamp: #C9ABF2;
    --flag: #FF9480;
    --on-stamp: #1A1226;
    --wax: #EDE4D3;
    --wax-edge: #9A8F7C;
    --metal: #7A7163;
    --flame: #F5AE45;
    --flame-core: #FFF6D6;
    --glow: rgba(245, 174, 69, .30);
  }
}
body {
  background: var(--ground); color: var(--ink);
  font-family: var(--font-assistant), system-ui, sans-serif;
}

/* ---- the days ---- */
.kitchen { width: 100%; max-width: 760px; margin: 0 auto; font-size: 18px; }
.kitchen .sheet {
  max-width: none; margin: 0 0 28px; padding: 0 0 14px;
  background: var(--paper); box-shadow: none;
}
.kitchen .day > :not(.day-head) { margin-inline: 16px; }

/* Sticky inside its own day, so the next day's band pushes this one away. */
.day-head {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding: 12px 16px; margin-bottom: 4px;
  background: var(--stamp); color: var(--on-stamp);
}
.day-head h2 { margin: 0; font-size: 26px; font-weight: 800; line-height: 1.15; }
.kitchen .day-head .counts { font-size: 15px; color: inherit; font-weight: 700; white-space: nowrap; }
.kitchen .empty { margin: 28px 16px; font-size: 20px; }

/* no pencil marks on a screen */
.kitchen .tick, .kitchen .box { display: none; }

/* ---- bigger type, same hierarchy ---- */
.kitchen .section-head { margin: 20px 0 8px; }
.kitchen .section-head h2 { font-size: 15px; }
.kitchen .stamp { font-size: 16px; padding: 1px 10px; }
.kitchen .qty { width: 40px; font-size: 20px; padding-inline-end: 10px; }
.kitchen .what { font-size: 20px; }
.kitchen .line { padding: 6px 0; }
.kitchen .bake .qty { font-size: 26px; }

.kitchen .recipes { grid-template-columns: 1fr; gap: 14px; }
.kitchen .recipe { padding-top: 8px; }
.kitchen .recipe-head h3 { font-size: 20px; }
.kitchen .recipe-yield { font-size: 14px; }
.kitchen .kind-head { margin-top: 8px; padding-inline-start: 0; }
.kitchen .kind-name { font-size: 13px; }
.kitchen .kind-sum { font-size: 14px; }
.kitchen .weigh { font-size: 18px; padding: 4px 0; gap: 8px; }
.kitchen .ing { white-space: normal; }
.kitchen .pct { font-size: 14px; min-width: 38px; }
.kitchen .gram { font-size: 19px; min-width: 74px; }
.kitchen .recipe-foot { font-size: 15px; margin-top: 6px; }
.kitchen .caveat { font-size: 15px; }

.kitchen .orders { margin-top: 22px; }
.kitchen .order { border-radius: 8px; margin-bottom: 12px; }
.kitchen .stub { width: 56px; padding: 10px 4px; background: var(--stub); }
.kitchen .stub .no { font-size: 13px; }
.kitchen .stub .id { font-size: 20px; }
.kitchen .body { padding: 10px 12px 12px; }
.kitchen .who { flex-wrap: wrap; gap: 4px 10px; margin-bottom: 6px; }
.kitchen .who h3 { font-size: 22px; }
.kitchen .sum { font-size: 20px; }
.kitchen .pay { font-size: 13px; padding: 2px 8px; }
.kitchen .meta { font-size: 16px; margin-top: 8px; }
.kitchen .note { font-size: 17px; margin-top: 6px; }
.kitchen .status { font-size: 13px; padding: 2px 8px; margin-top: 8px; }

/* ---- pinned to the bottom: the overdue / awaiting-approval counts over the freshness line ---- */
/* Sticky in the flow rather than fixed, so however many lines the dock grows to,
   the last card can still scroll clear of it. The body is a full-height flex
   column, so on a short day the dock still sits at the bottom. */
.dock { position: sticky; bottom: 0; z-index: 3; margin-top: auto; }
.live {
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: var(--paper); border-top: 1.5px solid var(--rule);
  font-size: 15px; font-weight: 600; color: var(--ink-soft); text-align: center;
  font-variant-numeric: tabular-nums;
}
/* Red alone is not enough (the sheet's no-colour-only rule): a box as well. */
.live-off {
  color: var(--flag); border-top: 3px solid var(--flag);
  outline: 2px solid var(--flag); outline-offset: -8px; font-weight: 800;
}
/* Information, not an alarm: ink on paper like the freshness line, a little larger. */
.attention {
  margin: 0; padding: 10px 16px 8px;
  background: var(--paper); color: var(--ink); border-top: 1.5px solid var(--rule);
  font-size: 15px; line-height: 1.35; text-align: center; text-wrap: balance;
}
.attention strong { display: block; font-size: 17px; font-weight: 700; }
.attention span { display: block; font-weight: 600; color: var(--ink-soft); }

/* ---- not connected / disconnected / pairing ---- */
.notice {
  flex: 1; min-height: 100dvh; box-sizing: border-box; width: 100%; max-width: 520px; margin: 0 auto;
  display: flex; flex-direction: column; justify-content: center; gap: 16px;
  padding: 32px 24px;
  font-family: var(--font-assistant), system-ui, sans-serif; color: var(--ink);
}
.notice-title { margin: 0; font-size: 32px; font-weight: 800; line-height: 1.15; }
.notice-body { margin: 0; font-size: 19px; line-height: 1.5; color: var(--ink-soft); }
.notice form { margin: 8px 0 0; }
.pair-btn {
  display: block; width: 100%; min-height: 64px; padding: 14px 20px;
  font: inherit; font-size: 21px; font-weight: 800; cursor: pointer;
  border: 2px solid var(--stamp); border-radius: 10px;
  background: var(--stamp); color: var(--on-stamp);
}
.pair-btn:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }

/* ---- Shabbat view: candle lighting to the end of the stretch, in place of the orders ---- */
.shabbat {
  flex: 1; min-height: 100dvh; width: 100%; max-width: 560px; margin: 0 auto;
  display: flex; flex-direction: column;
  padding: 20px 18px calc(12px + env(safe-area-inset-bottom));
}
.shabbat .hero { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 2px; padding-top: 4px; }
.shabbat .candles { width: 150px; height: auto; display: block; margin-bottom: 6px; overflow: visible; }
.shabbat .flame { transform-box: fill-box; transform-origin: 50% 92%; animation: flicker 3.1s ease-in-out infinite alternate; }
.shabbat .flame.b { animation-duration: 2.6s; animation-delay: -1.2s; }
@keyframes flicker {
  0% { transform: scale(1, 1) skewX(0); }
  30% { transform: scale(.95, 1.05) skewX(2.5deg); }
  60% { transform: scale(1.03, .96) skewX(-2deg); }
  100% { transform: scale(.98, 1.03) skewX(1deg); }
}
.shabbat .greeting { margin: 0; font-size: 52px; font-weight: 800; line-height: 1.05; text-wrap: balance; }
.shabbat .greeting.long { font-size: 40px; }
.shabbat .occasion { margin: 8px 0 0; font-size: 22px; font-weight: 700; }
.shabbat .hdate { margin: 0; font-size: 19px; font-weight: 600; color: var(--ink-soft); }
.shabbat .window { margin: 22px 0 0; display: grid; grid-template-columns: 1fr 1fr; background: var(--paper); border-radius: 8px; }
.shabbat .window div { padding: 12px 10px 10px; text-align: center; }
.shabbat .window div + div { border-inline-start: 2px dashed var(--rule); }
.shabbat .window .t {
  display: block; font-family: var(--font-jetbrains), ui-monospace, monospace; font-weight: 700;
  font-size: 40px; line-height: 1.1; font-variant-numeric: tabular-nums;
}
.shabbat .window .l { display: block; font-size: 16px; font-weight: 700; color: var(--ink-soft); }
.shabbat .next { margin: 20px 0 0; }
.shabbat .next h2 { margin: 0 0 4px; font-size: 15px; font-weight: 700; color: var(--ink-soft); }
.shabbat .next ul { margin: 0; padding: 0; list-style: none; }
.shabbat .next li {
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
  padding: 9px 2px; border-bottom: 1.5px solid var(--rule); font-size: 20px; font-weight: 600;
}
.shabbat .next li:last-child { border-bottom: 0; }
.shabbat .next li .t { font-family: var(--font-jetbrains), ui-monospace, monospace; font-weight: 500; font-size: 21px; font-variant-numeric: tabular-nums; }
.shabbat .next li.soon { font-weight: 800; }
.shabbat .next li.soon .t { font-weight: 700; }
.shabbat .next li:not(.soon) { color: var(--ink-soft); }
.shabbat .foot { margin-top: auto; padding-top: 18px; text-align: center; }
.shabbat .back { margin: 0; font-size: 16px; font-weight: 600; color: var(--ink-soft); }
.shabbat .credits {
  margin: 10px 0 0; font-family: system-ui, sans-serif; font-size: 9.5px; line-height: 1.35;
  color: var(--ink-soft); opacity: .85; text-align: left;
}
.shabbat .credits p { margin: 0 0 2px; }
@media (prefers-reduced-motion: reduce) { .shabbat .flame { animation: none; } }
@media (max-height: 700px) {
  .shabbat .candles { width: 110px; }
  .shabbat .greeting { font-size: 42px; }
  .shabbat .greeting.long { font-size: 34px; }
  .shabbat .window .t { font-size: 32px; }
  .shabbat .next li { padding: 6px 2px; }
  .shabbat .next li:nth-child(4) { display: none; }
}
`;
