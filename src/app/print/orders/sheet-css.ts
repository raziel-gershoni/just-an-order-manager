/**
 * The packing sheet's own stylesheet — deliberately plain CSS rather than the
 * app's Tailwind theme. This is the one surface whose substrate is paper: the
 * kraft ground that defines DOCKET on screen would cost a cartridge of toner
 * and make Hebrew harder to read, so the ticket language survives in structure
 * (stub, perforation, mono numerals, stamp) and not in colour.
 *
 * Nothing carries meaning by hue alone, so a mono printer loses no information:
 * unpaid is a boxed word, not a red one.
 */
export const SHEET_CSS = `
:root {
  --ink: #14110D;
  --ink-soft: #5C554A;
  --rule: #B7AF9F;
  --stamp: #5B3A8C;
  --flag: #B0311F;
}

body { background: #EFEBE2; }

/* ---- screen-only control strip ---- */
.controls {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
  max-width: 190mm; margin: 12px auto 0; padding: 10px 12px;
  background: #fff; border: 1px solid var(--rule); border-radius: 8px;
  font-family: var(--font-assistant), system-ui, sans-serif;
}
.tabs { display: flex; gap: 4px; }
.tab {
  padding: 7px 12px; border-radius: 6px; text-decoration: none;
  font-size: 14px; font-weight: 700; color: var(--ink-soft);
  border: 1.5px solid transparent;
}
.tab:hover { background: #F3F0E9; }
.tab-on { color: var(--stamp); border-color: var(--stamp); background: #F6F2FA; }
.tab:focus-visible, .pick input:focus-visible, .pick button:focus-visible, .print-btn:focus-visible {
  outline: 2px solid var(--stamp); outline-offset: 2px;
}
.pick { display: flex; gap: 6px; margin-inline-start: auto; }
.pick input, .pick button {
  font: inherit; font-size: 14px; padding: 6px 10px;
  border: 1.5px solid var(--rule); border-radius: 6px; background: #fff; color: var(--ink);
}
.pick button, .print-btn { font-weight: 700; cursor: pointer; }
.print-btn {
  font-family: var(--font-assistant), system-ui, sans-serif; font-size: 14px;
  padding: 7px 16px; border-radius: 6px; border: 1.5px solid var(--stamp);
  background: var(--stamp); color: #F4EEDD;
}

/* ---- the sheet ---- */
.sheet {
  max-width: 190mm; margin: 12px auto 40px; padding: 14mm 12mm;
  background: #fff; color: var(--ink);
  font-family: var(--font-assistant), system-ui, sans-serif;
  box-shadow: 0 1px 3px rgba(0,0,0,.14);
}
.expired { text-align: center; padding: 28mm 12mm; }
.expired h1 { font-size: 20px; margin: 0 0 8px; }
.expired p { color: var(--ink-soft); margin: 0; }

.head {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 16px;
  padding-bottom: 8px; border-bottom: 2.5px solid var(--ink);
}
.head-brand { display: flex; flex-direction: column; }
.brand { font-size: 19px; font-weight: 800; letter-spacing: -0.01em; }
.kind {
  font-size: 10px; font-weight: 700; letter-spacing: .22em;
  text-transform: uppercase; color: var(--ink-soft);
}
.head-when { display: flex; flex-direction: column; text-align: end; }
.when { font-size: 15px; font-weight: 700; }
.counts {
  font-family: var(--font-jetbrains), ui-monospace, monospace;
  font-size: 11px; color: var(--ink-soft); font-variant-numeric: tabular-nums;
}

.empty { margin: 18mm 0; text-align: center; color: var(--ink-soft); }

.section-head {
  display: flex; align-items: center; gap: 10px; margin: 14px 0 6px;
}
.section-head h2 {
  font-size: 11px; font-weight: 800; letter-spacing: .2em;
  text-transform: uppercase; color: var(--ink-soft); margin: 0;
}
.stamp {
  font-family: var(--font-jetbrains), ui-monospace, monospace;
  font-size: 11px; font-weight: 700; color: var(--stamp);
  border: 1.5px solid var(--stamp); border-radius: 4px; padding: 1px 8px;
  font-variant-numeric: tabular-nums;
}
.section-head::after {
  content: ''; flex: 1; border-top: 1px dashed var(--rule);
}

/* ---- item lines: the quantity gutter ---- */
.lines { list-style: none; margin: 0; padding: 0; }
.line {
  display: flex; align-items: baseline; gap: 10px;
  padding: 3.5px 0; border-bottom: 1px dashed var(--rule);
}
.line:last-child { border-bottom: 0; }
.qty {
  flex: none; width: 26px; text-align: end;
  font-family: var(--font-jetbrains), ui-monospace, monospace;
  font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums;
  border-inline-end: 1px solid var(--rule); padding-inline-end: 8px;
}
.what { flex: 1; font-size: 13.5px; font-weight: 600; }
.tick {
  flex: none; width: 11px; height: 11px; align-self: center;
  border: 1.2px solid var(--ink-soft); border-radius: 2px;
}

.bake .qty { font-size: 17px; }
.bake .what { font-weight: 700; }

/* ---- one order: stub + body ---- */
.orders { margin-top: 16px; }
.order {
  display: flex; align-items: stretch; gap: 0;
  border: 1.5px solid var(--rule); border-radius: 6px;
  margin-bottom: 8px; overflow: hidden;
}
.stub {
  flex: none; width: 15mm; display: flex; flex-direction: column;
  align-items: center; justify-content: flex-start; gap: 3px;
  padding: 8px 4px; border-inline-end: 1.5px dashed var(--rule); background: #FAF8F4;
}
.stub .no {
  font-family: var(--font-space-grotesk), sans-serif;
  font-size: 11px; color: var(--ink-soft); line-height: 1;
}
.stub .id {
  font-family: var(--font-jetbrains), ui-monospace, monospace;
  font-size: 16px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums;
}
.stub .box {
  margin-top: 4px; width: 15px; height: 15px;
  border: 1.5px solid var(--ink); border-radius: 3px;
}
.body { flex: 1; min-width: 0; padding: 8px 10px 9px; }

.who { display: flex; align-items: baseline; gap: 10px; margin-bottom: 5px; }
.who h3 { font-size: 16px; font-weight: 800; margin: 0; }
.money { margin-inline-start: auto; display: flex; align-items: center; gap: 7px; }
.sum {
  font-family: var(--font-jetbrains), ui-monospace, monospace;
  font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.pay {
  font-size: 9.5px; font-weight: 800; letter-spacing: .12em;
  padding: 1.5px 6px; border-radius: 3px; border: 1.2px solid;
}
.pay.paid { color: var(--ink-soft); border-color: var(--rule); }
.pay.owed { color: var(--flag); border-color: var(--flag); }

.meta {
  margin: 6px 0 0; font-size: 11.5px; color: var(--ink-soft); font-weight: 600;
}
/* Isolated so the surrounding Hebrew can't reorder the digits. */
.phone {
  unicode-bidi: isolate;
  font-family: var(--font-jetbrains), ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}
.note {
  margin: 4px 0 0; font-size: 12px; font-weight: 700; color: var(--flag);
  padding-inline-start: 8px; border-inline-start: 2.5px solid var(--flag);
}
.status {
  display: inline-block; margin-top: 6px;
  font-size: 9.5px; font-weight: 800; letter-spacing: .12em;
  color: var(--ink-soft); border: 1.2px dashed var(--rule); border-radius: 3px; padding: 1px 6px;
}

/* ---- paper ---- */
@page { size: A4; margin: 10mm 9mm; }
@media print {
  body { background: #fff; }
  .controls { display: none !important; }
  .sheet {
    max-width: none; margin: 0; padding: 0; box-shadow: none;
  }
  /* An order split across a page break is an order someone forgets to pack. */
  .order { break-inside: avoid; page-break-inside: avoid; }
  .bake { break-inside: avoid; page-break-inside: avoid; }
}
`;
