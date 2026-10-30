import { verifyExportToken } from '@/lib/export-token';
import { buildPrintSheet, resolveRange, type PrintPreset } from '@/lib/print-sheet';
import { PrintButton } from '@/components/print/PrintButton';
import { MixSection, BakeSection, OrderBlock } from '@/components/print/SheetParts';
import { SHEET_CSS } from './sheet-css';

export const dynamic = 'force-dynamic';

const PRESET_LABELS: Record<PrintPreset, string> = {
  yesterday: 'אתמול',
  today: 'היום',
  tomorrow: 'מחר',
  active: 'כל הפעילות',
};

export default async function PrintOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; d?: string }>;
}) {
  const { token, d } = await searchParams;
  const groupId = token ? verifyExportToken(token) : null;

  if (!groupId) {
    return (
      <>
        <style>{SHEET_CSS}</style>
        <main className="sheet expired">
          <h1>הקישור פג</h1>
          <p>קישורי הדפסה תקפים לחצי שעה. חזרו לאפליקציה והקישו שוב על ״הדפסה״.</p>
        </main>
      </>
    );
  }

  const { date, preset } = resolveRange(d);
  const sheet = await buildPrintSheet(groupId, date);
  const href = (range: string) => `/print/orders?token=${token}&d=${range}`;

  return (
    <>
      <style>{SHEET_CSS}</style>

      <nav className="controls" aria-label="בחירת תאריך">
        <div className="tabs">
          {(Object.keys(PRESET_LABELS) as PrintPreset[]).map((key) => (
            <a
              key={key}
              href={href(key)}
              className={preset === key ? 'tab tab-on' : 'tab'}
              aria-current={preset === key ? 'page' : undefined}
            >
              {PRESET_LABELS[key]}
            </a>
          ))}
        </div>
        {/* A plain GET form: date picking works with no JavaScript at all. */}
        <form className="pick" method="get" action="/print/orders">
          <input type="hidden" name="token" value={token} />
          <input type="date" name="d" defaultValue={date ?? ''} aria-label="תאריך" />
          <button type="submit">הצג</button>
        </form>
        <PrintButton />
      </nav>

      <main className="sheet">
        <header className="head">
          <div className="head-brand">
            <span className="brand">רזי הלחם</span>
            <span className="kind">גיליון אריזה</span>
          </div>
          <div className="head-when">
            <span className="when">{sheet.heading}</span>
            <span className="counts">
              {sheet.orders.length} הזמנות · {sheet.totalLoaves} פריטים
            </span>
          </div>
        </header>

        {sheet.orders.length === 0 ? (
          <p className="empty">אין הזמנות לתאריך הזה.</p>
        ) : (
          <>
            <MixSection sheet={sheet} />

            <BakeSection sheet={sheet} />

            <section className="orders" aria-label="הזמנות">
              {sheet.orders.map((o) => (
                <OrderBlock key={o.id} order={o} showDate={!sheet.date} />
              ))}
            </section>
          </>
        )}
      </main>
    </>
  );
}
