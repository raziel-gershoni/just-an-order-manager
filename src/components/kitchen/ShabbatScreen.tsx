import { t } from '@/lib/i18n';
import type { ShabbatCredit, ShabbatView } from '@/lib/shabbat-view';

const clockFormat = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jerusalem' });
const clock = (iso: string) => clockFormat.format(new Date(iso));

/**
 * What the kitchen screen shows from candle lighting to the end of a Shabbat or
 * Yom Tov instead of the orders (src/lib/shabbat-view.ts picks what is in
 * `view`): lit candles, the greeting, the occasion and Hebrew date, the two
 * times that frame the stretch, the next prayer times, when the orders come
 * back, and famcal's credits. Pure render: the screen keeps the clock.
 */
export function ShabbatScreen({ view, credits }: { view: ShabbatView; credits: ShabbatCredit[] }) {
  const { block, day, upcoming } = view;
  const long = block.greeting === 'shabbat_chag' || block.greeting === 'yom_kippur';
  const [backBefore, backAfter] = t('kitchen.shabbat_back').split('{time}');
  return (
    <main className="shabbat">
      <section className="hero">
        {/* Two glasses of olive oil on a tray, in the app's line-icon style; only the flames are coloured. */}
        <svg className="candles" viewBox="4 12 56 47" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <g style={{ stroke: 'var(--flame)' }}>
            <path d="M20 15.5C23.5 19.5 24.5 22.3 24.5 24.5A4.5 4.5 0 0 1 15.5 24.5C15.5 22.3 16.5 19.5 20 15.5Z" />
            <path d="M44 15.5C47.5 19.5 48.5 22.3 48.5 24.5A4.5 4.5 0 0 1 39.5 24.5C39.5 22.3 40.5 19.5 44 15.5Z" />
          </g>
          <g style={{ stroke: 'var(--ink)' }}>
            <path d="M12.5 31L14 52H26L27.5 31M20 36v-4" />
            <path d="M36.5 31L38 52H50L51.5 31M44 36v-4" />
            <path d="M13.3 36H26.7M37.3 36H50.7" strokeWidth="1.6" />
            <path d="M7 55.5h50" />
          </g>
        </svg>
        <h1 className={'greeting' + (long ? ' long' : '')}>{t('kitchen.shabbat_greeting_' + block.greeting)}</h1>
        {day.occasion && <p className="occasion">{day.occasion}</p>}
        <p className="hdate">{day.hebrewDate}</p>
      </section>
      <div className="window">
        <div>
          <span className="t" dir="ltr">{clock(block.start)}</span>
          <span className="l">{t('kitchen.shabbat_candles')}</span>
        </div>
        <div>
          <span className="t" dir="ltr">{clock(block.end)}</span>
          <span className="l">{block.endName}</span>
        </div>
      </div>
      {upcoming.length > 0 && (
        <section className="next">
          <h2>{t('kitchen.shabbat_next')}</h2>
          <ul>
            {upcoming.map((row, i) => (
              <li key={row.key + row.at} className={i === 0 ? 'soon' : undefined}>
                <span>{row.name}</span>
                <span className="t" dir="ltr">{clock(row.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer className="foot">
        <p className="back">
          {backBefore}
          <span dir="ltr">{clock(block.end)}</span>
          {backAfter}
        </p>
        <div className="credits" dir="ltr">
          {credits.map((c) => (
            <p key={c.source}>{c.text}</p>
          ))}
        </div>
      </footer>
    </main>
  );
}
