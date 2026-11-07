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
    <main className="shabbat" role="status">
      <section className="hero">
        <svg className="candles" viewBox="0 0 200 170" aria-hidden="true">
          <defs>
            <radialGradient id="shabbat-glow">
              <stop offset="0" stopColor="var(--glow)" stopOpacity="1" />
              <stop offset="1" stopColor="var(--glow)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g style={{ fill: 'var(--glow)' }}>
            <circle cx="70" cy="40" r="38" fill="url(#shabbat-glow)" />
            <circle cx="130" cy="40" r="38" fill="url(#shabbat-glow)" />
          </g>
          <g style={{ fill: 'var(--wax)', stroke: 'var(--wax-edge)' }} strokeWidth="1.5">
            <rect x="61" y="60" width="18" height="74" rx="2.5" />
            <rect x="121" y="60" width="18" height="74" rx="2.5" />
          </g>
          <g style={{ stroke: 'var(--ink)' }} strokeWidth="2" strokeLinecap="round">
            <line x1="70" y1="60" x2="70" y2="53" />
            <line x1="130" y1="60" x2="130" y2="53" />
          </g>
          <g className="flame">
            <path style={{ fill: 'var(--flame)' }} d="M70 18C79 31 83 40 79 48C76 54 64 54 61 48C57 40 61 31 70 18Z" />
            <path style={{ fill: 'var(--flame-core)' }} d="M70 32C74 38 75 43 73 47C71 50 69 50 67 47C65 43 66 38 70 32Z" />
          </g>
          <g className="flame b">
            <path style={{ fill: 'var(--flame)' }} d="M130 18C139 31 143 40 139 48C136 54 124 54 121 48C117 40 121 31 130 18Z" />
            <path style={{ fill: 'var(--flame-core)' }} d="M130 32C134 38 135 43 133 47C131 50 129 50 127 47C125 43 126 38 130 32Z" />
          </g>
          <g style={{ fill: 'var(--metal)' }}>
            <rect x="55" y="133" width="30" height="6" rx="3" />
            <rect x="67" y="139" width="6" height="18" />
            <ellipse cx="70" cy="159" rx="19" ry="5" />
            <rect x="115" y="133" width="30" height="6" rx="3" />
            <rect x="127" y="139" width="6" height="18" />
            <ellipse cx="130" cy="159" rx="19" ry="5" />
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
