'use client';

import { useState, type ReactNode } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useT } from '@/hooks/useLang';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHead } from '@/components/ui/SectionHead';
import { cn } from '@/lib/utils';
import {
  AUTO_CHARGE_SINCE,
  HEBREW_MONTHS,
  formatAgorot,
  formatIsoDate,
  type IncomeBread,
  type IncomeMonth,
  type IncomeReport,
} from '@/lib/income-report-types';

type T = ReturnType<typeof useT>;

/** Shown before "show all" — enough for the regulars, short enough to scroll past. */
const CUSTOMERS_PREVIEW = 15;

// Month name plus three money columns. 3.75rem holds "₪12,345" in the mono face
// and still leaves the month ~65px at a 320px phone.
const GRID = 'grid grid-cols-[minmax(0,1fr)_3.75rem_3.75rem_3.75rem] gap-x-1.5';

/**
 * ₪ and its digits as one LTR run. Always an inline span inside a plain span or
 * text: as a grid or flex item the isolate would become a block and flip its
 * own alignment.
 */
function Money({
  agorot,
  round,
  signed,
  className,
}: {
  agorot: number;
  round?: boolean;
  signed?: boolean;
  className?: string;
}) {
  return (
    <span dir="ltr" className={cn('font-mono tabular-nums', className)}>
      {formatAgorot(agorot, { round, signed })}
    </span>
  );
}

/** "label ········ value" — the dashboard hero's dotted leader. */
function Leader({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="whitespace-nowrap text-sm font-semibold">{label}</span>
      <span className="flex-1 -translate-y-1 border-b border-dotted border-border" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function pct(value: number, of: number): string {
  return `${Math.max(0, Math.min(100, (value / of) * 100))}%`;
}

function breadKey(b: IncomeBread): string {
  return `${b.breadTypeId}:${b.breadSizeId ?? 'none'}`;
}

function breadLabel(b: IncomeBread, t: T): string {
  return `${b.breadTypeName} ${b.sizeName ?? t('reports.no_size')}`;
}

function MonthRow({
  m,
  isCurrent,
  best,
  open,
  onToggle,
  breads,
  t,
}: {
  m: IncomeMonth;
  isCurrent: boolean;
  best: number;
  open: boolean;
  onToggle: () => void;
  breads: IncomeBread[];
  t: T;
}) {
  const name = HEBREW_MONTHS[m.month - 1];
  // Before the bakery's first recorded day there is nothing to report, which is
  // not the same as a month of ₪0.
  if (!m.hasData) {
    return (
      <div className={cn(GRID, 'px-4 py-2.5 text-sm text-muted-foreground/60')}>
        <span>{name}</span>
        <span>—</span>
        <span>—</span>
        <span>—</span>
      </div>
    );
  }
  const lines = breads
    .filter((b) => b.byMonth[m.month - 1] > 0)
    .sort((a, b) => b.byMonth[m.month - 1] - a.byMonth[m.month - 1]);
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="block w-full px-4 py-2.5 text-start transition-colors hover:bg-muted/40"
      >
        <div className={cn(GRID, 'items-baseline text-[13px]')}>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{name}</span>
            {isCurrent && (
              <span className="block text-[10px] font-semibold text-primary">{t('reports.so_far')}</span>
            )}
          </span>
          <span>
            <Money agorot={m.billed} round className="font-semibold" />
          </span>
          <span>
            <Money agorot={m.received} round />
          </span>
          <span>
            <Money
              agorot={m.owedAtEnd}
              round
              className={m.owedAtEnd > 0 ? 'text-destructive' : 'text-muted-foreground'}
            />
          </span>
        </div>
        {/* מחזור against the year's best month, with התקבל drawn over it. */}
        <div className="relative mt-1.5 h-[3px] overflow-hidden rounded-full bg-muted" aria-hidden>
          <span
            className="absolute inset-y-0 start-0 rounded-full bg-primary/30"
            style={{ width: pct(m.billed, best) }}
          />
          <span
            className="absolute inset-y-0 start-0 rounded-full bg-primary"
            style={{ width: pct(m.received, best) }}
          />
        </div>
      </button>
      {open && (
        <div className="space-y-1 border-t border-dashed border-border bg-muted/30 px-4 py-2.5 text-[13px]">
          <div className="text-muted-foreground">
            <span className="font-mono tabular-nums">{m.orders}</span> {t('reports.orders')}
            {' · '}
            <span className="font-mono tabular-nums">{m.units}</span> {t('reports.units')}
          </div>
          {lines.map((b) => (
            <div key={breadKey(b)} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate">{breadLabel(b, t)}</span>
              <span className="font-mono tabular-nums">{b.byMonth[m.month - 1]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Bread lines grouped under their type, in the server's order (biggest first). */
function groupBreads(breads: IncomeBread[]) {
  const groups: { typeId: number; typeName: string; total: number; sizes: IncomeBread[] }[] = [];
  for (const b of breads) {
    let g = groups.find((x) => x.typeId === b.breadTypeId);
    if (!g) groups.push((g = { typeId: b.breadTypeId, typeName: b.breadTypeName, total: 0, sizes: [] }));
    g.total += b.total;
    g.sizes.push(b);
  }
  return groups;
}

/**
 * The report itself, given the figures — no fetching, so it renders the same
 * from a fixture as from the API. Expanded month and "show all" are view state
 * and start closed for every report the page hands in.
 */
export function IncomeReportView({
  report: r,
  shownYear,
  loading,
  downloading,
  onYear,
  onDownload,
}: {
  report: IncomeReport;
  /** The year being shown or loaded — ahead of `report.year` while a step is in flight. */
  shownYear: number;
  loading: boolean;
  downloading: boolean;
  onYear: (year: number) => void;
  onDownload: () => void;
}) {
  const t = useT();
  const [openMonth, setOpenMonth] = useState<number | null>(null);
  const [allCustomers, setAllCustomers] = useState(false);

  const hasAnyData = r.months.some((m) => m.hasData);
  const best = Math.max(1, ...r.months.map((m) => Math.max(m.billed, m.received)));
  const breadGroups = groupBreads(r.breads);
  const customers = allCustomers ? r.customers : r.customers.slice(0, CUSTOMERS_PREVIEW);

  const footParts: ReactNode[] = [];
  if (r.totals.openingOwed > 0) {
    footParts.push(
      <span key="opening-owed">
        {t('reports.opening_owed')} <Money agorot={r.totals.openingOwed} />
      </span>
    );
  }
  if (r.totals.openingCredit > 0) {
    footParts.push(
      <span key="opening-credit">
        {t('reports.opening_credit')} <Money agorot={r.totals.openingCredit} />
      </span>
    );
  }
  if (r.totals.closingCredit > 0) {
    footParts.push(
      <span key="credit">
        {t('reports.credit')} <Money agorot={r.totals.closingCredit} />
      </span>
    );
  }

  return (
    <div className={cn('pb-32 animate-fade-in transition-opacity', loading && 'pointer-events-none opacity-60')}>
      {/* Year stepper. In RTL the right-pointing chevron is "back", as on the baker screen. */}
      <div className="flex items-center gap-1 px-4 pt-4">
        <button
          type="button"
          onClick={() => onYear(shownYear - 1)}
          disabled={shownYear <= r.firstYear}
          aria-label={t('reports.prev_year')}
          className="flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-muted disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <span className="font-display text-2xl font-bold tabular-nums">{shownYear}</span>
        <button
          type="button"
          onClick={() => onYear(shownYear + 1)}
          disabled={shownYear >= r.currentYear}
          aria-label={t('reports.next_year')}
          className="flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-muted disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <Button
          size="sm"
          variant="outline"
          className="ms-auto"
          onClick={onDownload}
          loading={downloading}
          disabled={!hasAnyData}
        >
          {!downloading && <Download className="h-4 w-4" />}
          {t('reports.download')}
        </Button>
      </div>

      {!hasAnyData ? (
        <EmptyState icon={BarChart3} title={t('reports.empty_title')} />
      ) : (
        <>
          <Card className="mx-4 mt-3 space-y-2.5">
            <Leader label={t('general.turnover')}>
              <Money agorot={r.totals.billed} className="text-2xl font-bold text-primary" />
            </Leader>
            <Leader label={t('reports.received')}>
              <Money agorot={r.totals.received} className="text-lg font-bold" />
            </Leader>
            <Leader label={r.isCurrentYear ? t('reports.owed_now') : t('reports.owed_year_end')}>
              <Money
                agorot={r.totals.closingOwed}
                className={cn('text-lg font-bold', r.totals.closingOwed > 0 && 'text-destructive')}
              />
            </Leader>
            {r.totals.adjusted !== 0 && (
              <Leader label={t('reports.adjusted')}>
                <Money agorot={r.totals.adjusted} className="font-semibold" />
              </Leader>
            )}
            {footParts.length > 0 && (
              <p className="text-[12px] text-muted-foreground">
                {footParts.map((part, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    {part}
                  </span>
                ))}
              </p>
            )}
          </Card>

          <SectionHead label={t('reports.by_month')} />
          <Card className="mx-4 overflow-hidden p-0">
            <div className={cn(GRID, 'px-4 pb-1.5 pt-3 text-[11px] font-semibold text-muted-foreground')}>
              <span>{t('reports.month')}</span>
              <span>{t('general.turnover')}</span>
              <span>{t('reports.received')}</span>
              <span>{t('reports.owed')}</span>
            </div>
            <div className="divide-y divide-border">
              {r.months.map((m) => (
                <MonthRow
                  key={m.month}
                  m={m}
                  isCurrent={m.month === r.currentMonth}
                  best={best}
                  open={openMonth === m.month}
                  onToggle={() => setOpenMonth(openMonth === m.month ? null : m.month)}
                  breads={r.breads}
                  t={t}
                />
              ))}
            </div>
          </Card>

          <SectionHead label={t('reports.breads')} loaves={r.totals.units} />
          {breadGroups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('reports.no_deliveries')}</p>
          ) : (
            <Card className="mx-4 divide-y divide-border overflow-hidden p-0">
              {breadGroups.map((g) => (
                <div key={g.typeId} className="px-4 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{g.typeName}</span>
                    <span className="font-mono text-sm font-bold tabular-nums">{g.total}</span>
                  </div>
                  {g.sizes.some((s) => s.sizeName) && (
                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                      {g.sizes.map((s, i) => (
                        <span key={breadKey(s)}>
                          {i > 0 && ' · '}
                          {s.sizeName ?? t('reports.no_size')}{' '}
                          <span className="font-mono tabular-nums">{s.total}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </Card>
          )}

          {r.customers.length > 0 && (
            <>
              <SectionHead label={t('reports.customers')} />
              <Card className="mx-4 overflow-hidden p-0">
                <div className={cn(GRID, 'px-4 pb-1.5 pt-3 text-[11px] font-semibold text-muted-foreground')}>
                  <span />
                  <span>{t('general.turnover')}</span>
                  <span>{t('reports.received')}</span>
                  <span>{t('reports.balance')}</span>
                </div>
                <div className="divide-y divide-border">
                  {customers.map((c) => (
                    <div key={c.customerId} className={cn(GRID, 'items-baseline px-4 py-2.5 text-[13px]')}>
                      <span
                        className={cn('min-w-0 truncate text-sm font-medium', !c.isActive && 'text-muted-foreground')}
                      >
                        {c.name}
                      </span>
                      <span>
                        <Money agorot={c.billed} round />
                      </span>
                      <span>
                        <Money agorot={c.received} round />
                      </span>
                      <span>
                        {c.closingBalance === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Money
                            agorot={c.closingBalance}
                            round
                            signed
                            className={cn('font-semibold', c.closingBalance < 0 ? 'text-destructive' : 'text-success')}
                          />
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {!allCustomers && r.customers.length > CUSTOMERS_PREVIEW && (
                  <button
                    type="button"
                    onClick={() => setAllCustomers(true)}
                    className="block w-full border-t border-border px-4 py-2.5 text-center text-sm font-medium text-primary hover:bg-muted/40"
                  >
                    {t('reports.show_all')} (<span className="font-mono tabular-nums">{r.customers.length}</span>)
                  </button>
                )}
              </Card>
            </>
          )}

          <div className="mx-5 mt-4 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
            <p>{t('reports.legend_money')}</p>
            {r.customers.length > 0 && <p>{t('reports.legend_balance')}</p>}
            {r.dataStart && r.dataStart.startsWith(String(r.year)) && (
              <p>
                {t('reports.data_starts')}
                <span dir="ltr" className="tabular-nums">
                  {formatIsoDate(r.dataStart)}
                </span>
              </p>
            )}
            {r.billedIncomplete && (
              <p>
                {t('reports.billed_partial_before')}{' '}
                <span dir="ltr" className="tabular-nums">
                  {formatIsoDate(AUTO_CHARGE_SINCE)}
                </span>{' '}
                {t('reports.billed_partial_after')}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
