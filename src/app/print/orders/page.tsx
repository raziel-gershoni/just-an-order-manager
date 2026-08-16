import { verifyExportToken } from '@/lib/export-token';
import {
  buildPrintSheet,
  resolveRange,
  type PrintOrder,
  type PrintPreset,
  type PrintRecipeBlock,
  type PrintSheet,
} from '@/lib/print-sheet';
import { formatWeekdayShort } from '@/lib/date-utils';
import { PrintButton } from '@/components/print/PrintButton';
import { SHEET_CSS } from './sheet-css';

export const dynamic = 'force-dynamic';

const PRESET_LABELS: Record<PrintPreset, string> = {
  yesterday: 'אתמול',
  today: 'היום',
  tomorrow: 'מחר',
  active: 'כל הפעילות',
};

const STATUS_STAMP: Record<string, string> = {
  delivered: 'נמסר',
  ready: 'מוכן',
  baking: 'באפייה',
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

            <section className="bake" aria-labelledby="bake-h">
              <div className="section-head">
                <h2 id="bake-h">לאפייה</h2>
                <span className="stamp">סה״כ {sheet.totalLoaves}</span>
              </div>
              <ul className="lines">
                {sheet.production.map((l) => (
                  <li key={l.label} className="line">
                    <span className="qty">{l.qty}</span>
                    <span className="what">{l.label}</span>
                    <span className="tick" aria-hidden="true" />
                  </li>
                ))}
              </ul>
            </section>

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

/** Grams stay in the sheet's RTL flow: bare digits sit correctly there, and the
 *  ״ג״ belongs to the left of the number the way Hebrew reads it. */
function grams(g: number): string {
  return `${Math.round(g).toLocaleString('en-US')}ג`;
}

/** What goes into the mixer, before anything is shaped. */
function MixSection({ sheet }: { sheet: PrintSheet }) {
  const { recipes, noRecipe, partialRecipe } = sheet;
  // Weights are a per-bake instruction, so they only belong on a dated sheet.
  // The active view spans whatever dates happen to be open, and summing those
  // into one dough describes a mix nobody should ever make. The loaf tally
  // below still covers the whole view.
  if (!sheet.date) return null;
  // No recipes at all means no weigh-out to print — and nothing for the caveat
  // to qualify. The caveat exists to stop *partial* weights reading as the
  // whole job, so it only appears alongside weights.
  if (recipes.length === 0) return null;

  const totalFlour = recipes.reduce((s, r) => s + r.flourGrams, 0);

  return (
    <section className="mix" aria-labelledby="mix-h">
      <div className="section-head">
        <h2 id="mix-h">לישה</h2>
        <span className="stamp">קמח {grams(totalFlour)}</span>
      </div>

      <div className="recipes">
        {recipes.map((r) => (
          <RecipeCard key={r.name} recipe={r} />
        ))}
      </div>

      {noRecipe.length > 0 && (
        <p className="caveat">ללא מתכון — נשקל ידנית: {noRecipe.join(' · ')}</p>
      )}
      {partialRecipe.length > 0 && (
        <p className="caveat">חסר משקל לגודל, הכמות חלקית: {partialRecipe.join(' · ')}</p>
      )}
    </section>
  );
}

function RecipeCard({ recipe }: { recipe: PrintRecipeBlock }) {
  return (
    <article className="recipe">
      <header className="recipe-head">
        <h3>{recipe.name}</h3>
        <span className="recipe-yield">
          {recipe.loaves} כיכרות · {grams(recipe.finishedGrams)}
        </span>
      </header>

      <ul className="weights">
        {recipe.lines.map((l) => (
          <li key={l.name} className="weigh">
            <span className="tick" aria-hidden="true" />
            <span className="ing">{l.name}</span>
            {/* The leader is what makes a line weighable at arm's length from
                a scale — the eye tracks the dots, not the row. */}
            <span className="leader" aria-hidden="true" />
            <span className="pct">{l.pctOfFlour.toFixed(0)}%</span>
            <span className="gram">{grams(l.grams)}</span>
          </li>
        ))}
      </ul>

      <footer className="recipe-foot">
        <span>סך קמח {grams(recipe.flourGrams)}</span>
        <span>סך בצק {grams(recipe.doughGrams)}</span>
      </footer>
    </article>
  );
}

function OrderBlock({ order, showDate }: { order: PrintOrder; showDate: boolean }) {
  const stamp = STATUS_STAMP[order.status];
  const where = order.isDelivery ? 'משלוח' : 'איסוף';
  const when = showDate
    ? order.deliveryDate
      ? formatWeekdayShort(order.deliveryDate)
      : 'בהקדם'
    : null;
  // Everything except the phone, which has to be bidi-isolated: an LTR number
  // dropped into an RTL line reorders, and "+972-52-828-0030" prints as
  // "52-828-0030 972+" — a number nobody can dial.
  const meta = [when, where, order.address].filter(Boolean).join(' · ');

  return (
    <article className="order">
      {/* The stub: id, and the box a pencil ticks when the bag is packed. */}
      <div className="stub" aria-hidden="true">
        <span className="no">№</span>
        <span className="id">{order.id}</span>
        <span className="box" />
      </div>

      <div className="body">
        <div className="who">
          <h3>{order.customerName}</h3>
          <span className="money">
            <span className="sum" dir="ltr">₪{order.total.toFixed(0)}</span>
            <span className={order.paid ? 'pay paid' : 'pay owed'}>
              {order.paid ? 'שולם' : 'לתשלום'}
            </span>
          </span>
        </div>

        <ul className="lines">
          {order.items.map((l, i) => (
            <li key={i} className="line">
              <span className="qty">{l.qty}</span>
              <span className="what">{l.label}</span>
              <span className="tick" aria-hidden="true" />
            </li>
          ))}
        </ul>

        {(meta || order.phone) && (
          <p className="meta">
            {meta}
            {meta && order.phone && ' · '}
            {order.phone && (
              <span className="phone" dir="ltr">
                {order.phone}
              </span>
            )}
          </p>
        )}
        {order.notes && <p className="note">{order.notes}</p>}
        {stamp && <span className="status">{stamp}</span>}
      </div>
    </article>
  );
}
