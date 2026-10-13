import writeXlsxFile from 'write-excel-file/node';
import type { CellObject, Row, Sheet } from 'write-excel-file/node';
import { t } from '@/lib/i18n';
import {
  AUTO_CHARGE_SINCE,
  HEBREW_MONTHS,
  formatIsoDate,
  formatIsraelDateTime,
  type IncomeReport,
} from '@/lib/income-report-types';
import type { IncomeTransaction } from '@/lib/income-report';

// The accountant's copy of the income report: five right-to-left sheets.
//
// Values only, never formulas. write-excel-file stores a formula with no cached
// result, and the previews people actually open a file in — Telegram's, iOS
// Quick Look — show such a cell blank. A total is worth nothing if it's empty.

const MONEY = '#,##0.00';

const head = (value: string): CellObject => ({
  value,
  type: String,
  fontWeight: 'bold',
  backgroundColor: '#EDE7DA',
  bottomBorderStyle: 'thin',
  alignVertical: 'center',
  wrap: true,
});
const text = (value: string): CellObject => ({ value, type: String });
const int = (value: number): CellObject => ({ value, type: Number });
// `|| 0` keeps a negated zero from printing as "-0.00".
const money = (agorot: number): CellObject => ({ value: agorot / 100 || 0, type: Number, format: MONEY });
const date = (iso: string): CellObject => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  // write-excel-file converts as UTC, so local midnight would print the day before.
  return { value: new Date(Date.UTC(y, m - 1, d)), type: Date, format: 'dd/mm/yyyy' };
};
const bold = (cell: CellObject): CellObject => ({ ...cell, fontWeight: 'bold' });
const totalRow = (cells: (CellObject | null)[]): Row =>
  cells.map((c) => (c ? { ...bold(c), topBorderStyle: 'thin' } : null));

const TYPE_LABEL: Record<IncomeTransaction['type'], string> = {
  charge: t('payment.charge'),
  payment: t('payment.payment'),
  adjustment: t('payment.adjustment'),
};

function closingLabel(r: IncomeReport): string {
  return r.isCurrentYear ? `נכון ל־${formatIsraelDateTime(r.generatedAt)}` : `31/12/${r.year}`;
}

function summarySheet(r: IncomeReport): Sheet<Buffer> {
  const turnover = t('general.turnover');
  // One unmerged cell per note with its height set: Excel never auto-fits a
  // merged cell, and leaves a wrapped note showing its first line only.
  const note = (value: string): Row => [
    { value, type: String, wrap: true, alignVertical: 'top', height: 15 * Math.ceil(value.length / 58) },
  ];
  const notes: Row[] = [
    note('הסכומים הם כפי שנרשמו באפליקציה, לפי מועד הרישום, בשעון ישראל.'),
    note(`${turnover} = חיובים. הזמנה מחויבת ברגע שהיא מסומנת כנמסרה; הסכום כולל דמי משלוח, וגם חיובים שנרשמו ידנית.`),
    note('תקבולים = תשלומים לפי היום שבו נרשמו, לא בהכרח היום שבו שולמו. אמצעי התשלום מופיע רק אם נכתב בהערה (גיליון תנועות).'),
    note('יחידות נספרות לפי תאריך המסירה, וחיוב לפי רגע הסימון כנמסר — מסירה שסומנה באיחור בסוף חודש תיספר בחודש הבא.'),
    note('בגיליון לקוחות, חוב שלילי הוא יתרת זכות ללקוח.'),
    note('מע״מ אינו מופרד. הדוח אינו מחליף קבלות או חשבוניות.'),
  ];
  if (r.dataStart && r.dataStart.startsWith(String(r.year))) {
    notes.push(note(`הנתונים באפליקציה מתחילים ב־${formatIsoDate(r.dataStart)}.`));
  }
  if (r.billedIncomplete) {
    notes.push(
      note(
        `חיובים לפני ${formatIsoDate(AUTO_CHARGE_SINCE)} אינם שלמים: עד אז חיוב נרשם רק כשהושלם רישום התשלום של ההזמנה.`
      )
    );
  }

  const data: Row[] = [
    [{ value: `דוח הכנסות ${r.year}`, type: String, fontWeight: 'bold', fontSize: 14 }, null],
    [text(r.groupName), null],
    [text('הופק'), text(formatIsraelDateTime(r.generatedAt))],
    [],
    [head('סעיף'), head('סכום (₪)')],
    [text(`${turnover} (חיובים)`), money(r.totals.billed)],
    [text('תקבולים (תשלומים שנרשמו)'), money(r.totals.received)],
    [text('התאמות'), money(r.totals.adjusted)],
    [text(`חובות לקוחות — פתיחה (01/01/${r.year})`), money(r.totals.openingOwed)],
    [text(`יתרות זכות של לקוחות — פתיחה (01/01/${r.year})`), money(r.totals.openingCredit)],
    [text(`חובות לקוחות — סגירה (${closingLabel(r)})`), money(r.totals.closingOwed)],
    [text(`יתרות זכות של לקוחות — סגירה (${closingLabel(r)})`), money(r.totals.closingCredit)],
    [],
    [head('כמויות'), head('מספר')],
    [text('הזמנות שנמסרו'), int(r.totals.orders)],
    [text('יחידות שנמסרו'), int(r.totals.units)],
    [],
    [bold(text('הערות')), null],
    ...notes,
  ];
  return { sheet: 'סיכום', data, columns: [{ width: 64 }, { width: 18 }], rightToLeft: true };
}

function monthsSheet(r: IncomeReport): Sheet<Buffer> {
  const header: Row = [
    head('חודש'),
    head('הזמנות שנמסרו'),
    head('יחידות'),
    head(`${t('general.turnover')} (₪)`),
    head('תקבולים (₪)'),
    head('התאמות (₪)'),
    head('חובות בסוף החודש (₪)'),
    head('יתרות זכות בסוף החודש (₪)'),
  ];
  const rows: Row[] = r.months.map((m) => {
    const name = HEBREW_MONTHS[m.month - 1];
    const label = m.month === r.currentMonth ? `${name} (עד היום)` : name;
    if (!m.hasData) return [text(label)];
    return [
      text(label),
      int(m.orders),
      int(m.units),
      money(m.billed),
      money(m.received),
      money(m.adjusted),
      money(m.owedAtEnd),
      money(m.creditAtEnd),
    ];
  });
  const total = totalRow([
    text('סה״כ'),
    int(r.totals.orders),
    int(r.totals.units),
    money(r.totals.billed),
    money(r.totals.received),
    money(r.totals.adjusted),
    // Point-in-time balances: the total is the closing value, never a sum.
    money(r.totals.closingOwed),
    money(r.totals.closingCredit),
  ]);
  return {
    sheet: 'חודשים',
    data: [header, ...rows, total],
    columns: [{ width: 16 }, { width: 10 }, { width: 10 }, { width: 13 }, { width: 13 }, { width: 11 }, { width: 14 }, { width: 14 }],
    rightToLeft: true,
    stickyRowsCount: 1,
  };
}

function breadsSheet(r: IncomeReport): Sheet<Buffer> {
  const header: Row = [head('סוג לחם'), head('גודל'), ...HEBREW_MONTHS.map(head), head('סה״כ')];
  const rows: Row[] = r.breads.map((b) => [
    text(b.breadTypeName),
    text(b.sizeName ?? 'ללא גודל'),
    ...b.byMonth.map(int),
    bold(int(b.total)),
  ]);
  const byMonth = Array.from({ length: 12 }, (_, i) => r.breads.reduce((s, b) => s + b.byMonth[i], 0));
  const total = totalRow([text('סה״כ'), null, ...byMonth.map(int), int(r.totals.units)]);
  return {
    sheet: 'לחמים',
    data: [header, ...rows, total],
    columns: [{ width: 18 }, { width: 14 }, ...HEBREW_MONTHS.map(() => ({ width: 8 })), { width: 9 }],
    rightToLeft: true,
    stickyRowsCount: 1,
  };
}

function customersSheet(r: IncomeReport): Sheet<Buffer> {
  const header: Row = [
    head('מס׳ לקוח'),
    head('שם'),
    head('פעיל'),
    head('חוב בפתיחה (₪)'),
    head(`${t('general.turnover')} (₪)`),
    head('תקבולים (₪)'),
    head('התאמות (₪)'),
    head('חוב בסגירה (₪)'),
  ];
  // Debt is the ledger balance turned around: positive = the customer owes.
  const rows: Row[] = r.customers.map((c) => [
    int(c.customerId),
    text(c.name),
    text(c.isActive ? 'כן' : 'לא'),
    money(-c.openingBalance),
    money(c.billed),
    money(c.received),
    money(c.adjusted),
    money(-c.closingBalance),
  ]);
  const sum = (f: (c: IncomeReport['customers'][number]) => number) =>
    r.customers.reduce((s, c) => s + f(c), 0);
  const total = totalRow([
    null,
    text('סה״כ'),
    null,
    money(-sum((c) => c.openingBalance)),
    money(sum((c) => c.billed)),
    money(sum((c) => c.received)),
    money(sum((c) => c.adjusted)),
    money(-sum((c) => c.closingBalance)),
  ]);
  return {
    sheet: 'לקוחות',
    data: [header, ...rows, total],
    columns: [{ width: 9 }, { width: 24 }, { width: 6 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 11 }, { width: 13 }],
    rightToLeft: true,
    stickyRowsCount: 1,
  };
}

function transactionsSheet(transactions: IncomeTransaction[]): Sheet<Buffer> {
  const header: Row = [
    head('תאריך'),
    head('שעה'),
    head('מס׳ לקוח'),
    head('לקוח'),
    head('סוג'),
    head('חיוב (₪)'),
    head('תקבול (₪)'),
    head('התאמה (₪)'),
    head('הזמנה'),
    head('תאריך מסירה'),
    head('הערה'),
  ];
  const rows: Row[] = transactions.map((x) => [
    date(x.at),
    text(x.at.slice(11)),
    int(x.customerId),
    text(x.customerName),
    text(TYPE_LABEL[x.type] ?? x.type),
    x.type === 'charge' ? money(-x.agorot) : null,
    x.type === 'payment' ? money(x.agorot) : null,
    x.type === 'adjustment' ? money(x.agorot) : null,
    x.orderId == null ? null : int(x.orderId),
    x.deliveryDate ? date(x.deliveryDate) : null,
    x.description ? text(x.description) : null,
  ]);
  const sum = (type: IncomeTransaction['type']) =>
    transactions.filter((x) => x.type === type).reduce((s, x) => s + x.agorot, 0);
  const total = totalRow([
    text('סה״כ'),
    null,
    null,
    null,
    null,
    money(-sum('charge')),
    money(sum('payment')),
    money(sum('adjustment')),
    null,
    null,
    null,
  ]);
  return {
    sheet: 'תנועות',
    data: [header, ...rows, total],
    columns: [
      { width: 11 }, { width: 7 }, { width: 9 }, { width: 22 }, { width: 8 },
      { width: 11 }, { width: 11 }, { width: 11 }, { width: 8 }, { width: 12 }, { width: 30 },
    ],
    rightToLeft: true,
    stickyRowsCount: 1,
  };
}

export async function buildIncomeWorkbook(
  report: IncomeReport,
  transactions: IncomeTransaction[]
): Promise<Buffer> {
  return writeXlsxFile(
    [
      summarySheet(report),
      monthsSheet(report),
      breadsSheet(report),
      customersSheet(report),
      transactionsSheet(transactions),
    ],
    { fontFamily: 'Arial', fontSize: 11 }
  ).toBuffer();
}
