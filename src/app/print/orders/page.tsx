import { verifyExportToken } from '@/lib/export-token';
import { buildPrintSheet, resolveRange, type PrintPreset, type PrintSheet } from '@/lib/print-sheet';
import { getOrderDisplay } from '@/lib/asap';
import { todayStr } from '@/lib/date-utils';
import { t } from '@/lib/i18n';
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

/**
 * `v=orders` prints the bags only, for whoever delivers: no mixing weights and
 * no bake count. Kept in every link on the page so moving between dates keeps
 * it; a new print link from the app opens the full sheet again.
 */
const ORDERS_ONLY = 'orders';

function Sheet({ sheet, heading, ordersOnly }: { sheet: PrintSheet; heading: string; ordersOnly: boolean }) {
  return (
    <main className="sheet">
      <header className="head">
        <div className="head-brand">
          <span className="brand">רזי הלחם</span>
          <span className="kind">גיליון אריזה</span>
        </div>
        <div className="head-when">
          <span className="when">{heading}</span>
          <span className="counts">
            {sheet.orders.length} הזמנות · {sheet.totalLoaves} פריטים
          </span>
        </div>
      </header>

      {sheet.orders.length === 0 ? (
        <p className="empty">אין הזמנות לתאריך הזה.</p>
      ) : (
        <>
          {!ordersOnly && (
            <>
              <MixSection sheet={sheet} />

              <BakeSection sheet={sheet} />
            </>
          )}

          <section className="orders" aria-label="הזמנות">
            {sheet.orders.map((o) => (
              <OrderBlock key={o.id} order={o} showDate={!sheet.date || !o.deliveryDate} />
            ))}
          </section>
        </>
      )}
    </main>
  );
}

export default async function PrintOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; d?: string; v?: string }>;
}) {
  const { token, d, v } = await searchParams;
  const ordersOnly = v === ORDERS_ONLY;
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
  // The bakery's בהקדם switch only touches today's sheet: inside it, or a sheet of their own before it.
  const display = date === todayStr() ? await getOrderDisplay(groupId) : null;
  const asapSheet =
    display && !display.asapInToday ? await buildPrintSheet(groupId, null, { undatedOnly: true }) : null;
  const sheet = await buildPrintSheet(groupId, date, { withUndated: !!display?.asapInToday });
  const href = (range: string, only = ordersOnly) =>
    `/print/orders?token=${token}&d=${range}${only ? `&v=${ORDERS_ONLY}` : ''}`;

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
        <div className="tabs" role="group" aria-label={t('print.view_label')}>
          {[false, true].map((only) => (
            <a
              key={String(only)}
              href={href(preset ?? date ?? 'today', only)}
              className={ordersOnly === only ? 'tab tab-on' : 'tab'}
              aria-current={ordersOnly === only ? 'page' : undefined}
            >
              {only ? t('print.view_orders') : t('print.view_full')}
            </a>
          ))}
        </div>
        {/* A plain GET form: date picking works with no JavaScript at all. */}
        <form className="pick" method="get" action="/print/orders">
          <input type="hidden" name="token" value={token} />
          {ordersOnly && <input type="hidden" name="v" value={ORDERS_ONLY} />}
          <input type="date" name="d" defaultValue={date ?? ''} aria-label="תאריך" />
          <button type="submit">הצג</button>
        </form>
        <PrintButton />
      </nav>

      {asapSheet && asapSheet.orders.length > 0 && (
        <Sheet sheet={asapSheet} heading={t('delivery.asap')} ordersOnly={ordersOnly} />
      )}
      <Sheet sheet={sheet} heading={sheet.heading} ordersOnly={ordersOnly} />
    </>
  );
}
