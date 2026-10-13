'use client';

import { Bell, BellOff, Check, MessageCircleOff, type LucideIcon } from 'lucide-react';
import { useT } from '@/hooks/useLang';
import { cn } from '@/lib/utils';

/**
 * What a number gets, as one choice. Two columns underneath — `notify` and
 * `has_whatsapp` — but only three states a person means: a number off WhatsApp
 * has nothing to silence, so "silenced and off WhatsApp" isn't a fourth.
 */
export type PhoneMessaging = 'on' | 'muted' | 'none';

export function messagingOf(p: { notify: boolean; hasWhatsapp: boolean }): PhoneMessaging {
  if (!p.hasWhatsapp) return 'none';
  return p.notify ? 'on' : 'muted';
}

/**
 * The PATCH for a choice. "Off WhatsApp" leaves `notify` alone, so a number
 * marked back as on WhatsApp keeps whatever it said before.
 */
export function messagingPatch(state: PhoneMessaging): { hasWhatsapp: boolean; notify?: boolean } {
  if (state === 'none') return { hasWhatsapp: false };
  return { hasWhatsapp: true, notify: state === 'on' };
}

export const MESSAGING_ICON: Record<PhoneMessaging, { icon: LucideIcon; className: string }> = {
  on: { icon: Bell, className: 'text-primary' },
  muted: { icon: BellOff, className: 'text-muted-foreground' },
  none: { icon: MessageCircleOff, className: 'text-muted-foreground/70' },
};

const LABEL: Record<PhoneMessaging, string> = {
  on: 'customers.notify_on',
  muted: 'customers.notify_off',
  none: 'customers.no_whatsapp',
};

/**
 * The row's control: the current state as its icon, opening the menu. A number
 * off WhatsApp shows the crossed-out chat in the bell's place — there is
 * nothing to silence.
 */
export function PhoneMessagingButton({ state, onClick }: { state: PhoneMessaging; onClick: () => void }) {
  const t = useT();
  const { icon: Icon, className } = MESSAGING_ICON[state];
  const label = t(LABEL[state]);
  return (
    <button
      type="button"
      aria-label={`${label} · ${t('customers.msg_change')}`}
      aria-haspopup="dialog"
      title={label}
      onClick={onClick}
      className="inline-flex h-11 w-11 items-center justify-center rounded-lg transition-all duration-150 hover:bg-muted active:scale-[0.98]"
    >
      <Icon className={cn('h-4 w-4', className)} />
    </button>
  );
}

const OPTIONS: { state: PhoneMessaging; label: string; hint: string }[] = [
  { state: 'on', label: 'customers.notify_on', hint: 'customers.msg_on_hint' },
  { state: 'muted', label: 'customers.msg_muted', hint: 'customers.msg_muted_hint' },
  { state: 'none', label: 'customers.no_whatsapp', hint: 'customers.msg_none_hint' },
];

/**
 * The bell's menu on the customer card: one place for everything that decides
 * whether a number is messaged. Set rarely and on purpose, so a deliberate pick
 * from three beats a one-tap cycle that can overshoot.
 */
export function PhoneMessagingSheet({
  phone,
  name,
  current,
  onPick,
  onClose,
}: {
  phone: string;
  name: string | null;
  current: PhoneMessaging;
  onPick: (state: PhoneMessaging) => void;
  onClose: () => void;
}) {
  const t = useT();

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 animate-fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('customers.msg_title')}
        className="w-full rounded-t-2xl border-t border-border bg-card pb-[calc(1rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-sm font-bold">{t('customers.msg_title')}</h2>
          {/* Digits isolated on their own; the label and separator stay in the
              Hebrew flow. */}
          <p className="truncate text-xs text-muted-foreground">
            {name?.trim() && (
              <>
                {name.trim()}
                {' · '}
              </>
            )}
            <span dir="ltr" className="tabular-nums">
              {phone}
            </span>
          </p>
        </div>

        <div className="px-2 pb-2">
          {OPTIONS.map((o) => {
            const { icon: Icon, className } = MESSAGING_ICON[o.state];
            const selected = o.state === current;
            return (
              <button
                key={o.state}
                type="button"
                aria-pressed={selected}
                onClick={() => onPick(o.state)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-start transition-colors hover:bg-muted/50',
                  selected && 'bg-muted/40'
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', className)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t(o.label)}</span>
                  <span className="block text-[11px] text-muted-foreground">{t(o.hint)}</span>
                </span>
                {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
