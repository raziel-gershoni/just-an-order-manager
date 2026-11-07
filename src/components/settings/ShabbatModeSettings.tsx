'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useToast } from '@/hooks/useToast';
import { useT } from '@/hooks/useLang';
import { LoadError } from '@/components/ui/LoadError';
import { FAMCAL_CITIES } from '@/lib/famcal-cities';
import { formatWeekdayShort, israelDateStr } from '@/lib/date-utils';
// Types only: the server module (database, famcal's client) must never reach the bundle.
import type { ShabbatSettings } from '@/lib/shabbat-times';
import type { Community } from '@/lib/famcal';

const COMMUNITY_KEYS = ['sephardi', 'ashkenazi', 'chabad'] as const satisfies readonly Community[];

const clock = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jerusalem' });

const selectClass =
  'w-full rounded-lg border border-input bg-card px-3 py-2.5 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-60';

function SwitchRow({ on, disabled, onToggle }: { on: boolean; disabled: boolean; onToggle: (next: boolean) => void }) {
  const t = useT();
  return (
    <>
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium">{t('kitchen.shabbat_mode')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={disabled}
          onClick={() => onToggle(!on)}
          className={'relative h-7 w-12 flex-none rounded-full transition-colors ' + (on ? 'bg-success' : 'bg-muted')}
        >
          <span className={'absolute top-1 h-5 w-5 rounded-full bg-card shadow transition-all ' + (on ? 'start-6' : 'start-1')} />
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">{t('kitchen.shabbat_mode_hint')}</p>
    </>
  );
}

/** A preview line: the label, then the weekday and date and the Israel-time clock of the instant. */
function PreviewLine({ label, at }: { label: string; at: string }) {
  const t = useT();
  const [before, after = ''] = t('kitchen.shabbat_preview_time').split('{time}');
  const day = formatWeekdayShort(israelDateStr(new Date(at)));
  const head = before.replace('{label}', label).replace('{day}', day);
  return (
    <p className="text-sm">
      {head}
      <span dir="ltr">{clock.format(new Date(at))}</span>
      {after}
    </p>
  );
}

/** The presentational form: the switch, and while the mode is on (or being turned on) the city, the community, the next stretch and famcal's credits. */
export function ShabbatModeForm({
  settings,
  pendingOn,
  saving,
  fetching,
  onToggle,
  onCity,
  onCommunity,
}: {
  settings: ShabbatSettings;
  pendingOn: boolean;
  saving: boolean;
  /** A city is being fetched from famcal (turning the mode off asks nothing of famcal). */
  fetching: boolean;
  onToggle: (next: boolean) => void;
  onCity: (slug: string) => void;
  onCommunity: (c: Community) => void;
}) {
  const t = useT();
  const on = settings.city !== null || pendingOn;
  const notFound = pendingOn && settings.city === null && settings.suggestedCity === null && settings.homeCity;
  const next = settings.next;
  return (
    <div className="mb-4">
      <SwitchRow on={on} disabled={saving} onToggle={onToggle} />
      {on && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">{t('kitchen.shabbat_city')}</span>
            <select value={settings.city ?? ''} disabled={saving} onChange={(e) => e.target.value && onCity(e.target.value)} className={selectClass}>
              {settings.city === null && <option value="">{t('kitchen.shabbat_city_pick')}</option>}
              {FAMCAL_CITIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
            {notFound && <span className="text-xs text-muted-foreground">{t('kitchen.shabbat_city_not_found').replace('{city}', notFound)}</span>}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">{t('kitchen.shabbat_community')}</span>
            <select value={settings.community} disabled={saving} onChange={(e) => onCommunity(e.target.value as Community)} className={selectClass}>
              {COMMUNITY_KEYS.map((c) => (
                <option key={c} value={c}>
                  {t(`kitchen.shabbat_community_${c}`)}
                </option>
              ))}
            </select>
          </label>
          {fetching && <p className="text-xs text-muted-foreground">{t('kitchen.shabbat_saving')}</p>}
          {next && (
            <div className="flex flex-col gap-0.5">
              {next.occasion && <p className="text-sm font-medium">{next.occasion}</p>}
              <PreviewLine label={t('kitchen.shabbat_candles')} at={next.start} />
              <PreviewLine label={next.endName} at={next.end} />
            </div>
          )}
          {settings.credits.length > 0 && (
            <div dir="ltr" className="text-[10px] leading-snug text-muted-foreground">
              {settings.credits.map((c) => (
                <p key={c.source}>{c.text}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Loads the Shabbat mode settings and saves each change at once; a save asks famcal first, so a failure leaves the controls as they were. */
export function ShabbatModeSettings({ groupId }: { groupId: number }) {
  const { apiFetch } = useApi();
  const toast = useToast();
  const t = useT();
  const [settings, setSettings] = useState<ShabbatSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pendingOn, setPendingOn] = useState(false);
  // The community picked before any city is: it rides along with the first save.
  const [localCommunity, setLocalCommunity] = useState<Community | null>(null);
  // The choice being saved, shown while famcal answers; a failure drops it and the controls go back.
  const [inFlight, setInFlight] = useState<{ city: string; community: Community } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await apiFetch<ShabbatSettings>(`/groups/${groupId}/shabbat`));
      setLoadFailed(false);
    } catch (err) {
      console.error('[shabbat] settings load failed:', err);
      setLoadFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apiFetch is rebuilt every render; the group is the input
  }, [groupId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(city: string | null, community: Community) {
    setSaving(true);
    if (city !== null) setInFlight({ city, community });
    try {
      const next = await apiFetch<ShabbatSettings>(`/groups/${groupId}/shabbat`, { method: 'PUT', body: JSON.stringify({ city, community }) });
      setSettings(next);
      setPendingOn(false);
      setLocalCommunity(null);
    } catch (err) {
      console.error('[shabbat] save failed:', err);
      // The route names famcal's failures (src/app/api/groups/[id]/shabbat/route.ts).
      const code = err instanceof Error ? err.message : '';
      toast.error(
        code === 'famcal_no_key'
          ? t('kitchen.shabbat_no_key')
          : code === 'famcal_key_refused'
            ? t('kitchen.shabbat_key_refused')
            : code === 'famcal_failed'
              ? t('kitchen.shabbat_famcal_failed')
              : t('settings.save_failed')
      );
    } finally {
      setSaving(false);
      setInFlight(null);
    }
  }

  if (loadFailed) return <LoadError compact onRetry={load} />;
  if (!settings) {
    return (
      <div className="mb-4">
        <SwitchRow on={false} disabled onToggle={() => {}} />
      </div>
    );
  }

  const shown = inFlight ? { ...settings, ...inFlight } : localCommunity ? { ...settings, community: localCommunity } : settings;
  return (
    <ShabbatModeForm
      settings={shown}
      pendingOn={pendingOn}
      saving={saving}
      fetching={inFlight !== null}
      onToggle={(on) => {
        if (on) {
          if (settings.suggestedCity) void save(settings.suggestedCity, shown.community);
          else setPendingOn(true);
        } else if (pendingOn && settings.city === null) {
          setPendingOn(false);
        } else {
          void save(null, shown.community);
        }
      }}
      onCity={(slug) => void save(slug, shown.community)}
      onCommunity={(c) => {
        if (settings.city) void save(settings.city, c);
        else setLocalCommunity(c);
      }}
    />
  );
}
