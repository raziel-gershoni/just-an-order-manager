import { MixSection, BakeSection, OrderBlock } from '@/components/print/SheetParts';
import { headingFor } from '@/lib/print-sheet';
import { t } from '@/lib/i18n';
import type { KitchenData, KitchenDay } from '@/lib/kitchen-sheet';

const count = (n: number, one: string, many: string) => (n === 1 ? t(one) : t(many).replace('{n}', String(n)));

function dayTitle(day: KitchenDay): string {
  if (day.kind === 'asap') return t('kitchen.asap');
  const date = headingFor(day.date);
  if (day.kind === 'today') return `${t('kitchen.today')} · ${date}`;
  if (day.kind === 'tomorrow') return `${t('kitchen.tomorrow')} · ${date}`;
  return date;
}

function DaySheet({ day }: { day: KitchenDay }) {
  const { sheet } = day;
  const prefix = `${day.key}-`;
  return (
    <section className="sheet day" aria-labelledby={`${prefix}day-h`}>
      <header className="day-head">
        <h2 id={`${prefix}day-h`}>{dayTitle(day)}</h2>
        <span className="counts">
          {count(sheet.orders.length, 'kitchen.orders_one', 'kitchen.orders_many')} ·{' '}
          {count(sheet.totalLoaves, 'kitchen.items_one', 'kitchen.items_many')}
        </span>
      </header>
      {sheet.orders.length === 0 ? (
        <p className="empty">{t('kitchen.no_orders_today')}</p>
      ) : (
        <>
          <MixSection sheet={sheet} idPrefix={prefix} />
          <BakeSection sheet={sheet} idPrefix={prefix} />
          <section className="orders" aria-label={dayTitle(day)}>
            {sheet.orders.map((o) => (
              <OrderBlock key={o.id} order={o} showDate={false} />
            ))}
          </section>
        </>
      )}
    </section>
  );
}

export function KitchenSheets({ data }: { data: KitchenData }) {
  return (
    <main className="kitchen">
      {data.days.map((day) => (
        <DaySheet key={day.key} day={day} />
      ))}
    </main>
  );
}
