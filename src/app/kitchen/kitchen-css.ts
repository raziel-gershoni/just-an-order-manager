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
  }
}
body {
  background: var(--ground); color: var(--ink);
  font-family: var(--font-assistant), system-ui, sans-serif;
}

/* ---- the days ---- */
.kitchen { width: 100%; max-width: 760px; margin: 0 auto; padding-bottom: 88px; font-size: 18px; }
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

/* ---- freshness line ---- */
.live {
  position: fixed; inset-inline: 0; bottom: 0; z-index: 3;
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
`;
