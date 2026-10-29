// Client-safe shapes for an order read from a message, shared by the bot (which
// builds and summarises the draft) and the new-order form (which opens it).
// The server side, with the prompt and the Gemini call, is ./order-from-message.ts.

import { t } from '@/lib/i18n';
import { comingFriday, formatDayMonth } from '@/lib/date-utils';
import { customerNameMatches } from '@/lib/name-utils';

/** Something the reading left out or couldn't place, shown in the summary and the form's banner. */
export type DraftWarning =
  | { kind: 'not_on_menu'; heard: string }
  | { kind: 'addition_dropped'; heard: string }
  | { kind: 'bad_quantity'; heard: string }
  | { kind: 'date_unclear'; heard: string }
  | { kind: 'date_past'; date: string }
  | { kind: 'multiple_orders' }
  | { kind: 'past_order_reference'; heard: string };

/** One line, already checked against the menu. `heard` is the words that described it. */
export interface DraftLine {
  breadTypeId: number;
  breadSizeId: number | null;
  breadAdditionIds: number[];
  quantity: number;
  heard: string;
}

export interface OrderDraft {
  customer: { spokenName: string | null; candidateIds: number[] };
  lines: DraftLine[];
  timing: { kind: 'shabbat' | 'asap' | 'date' | 'none'; date: string | null; heard: string | null };
  recurring: boolean | null;
  delivery: boolean | null;
  notes: string | null;
  warnings: DraftWarning[];
}

/** Candidates the model named that are still active, plus every active customer the picker's search on the spoken name finds. */
export function resolveCustomerCandidates(
  spokenName: string | null,
  candidateIds: number[],
  customers: { id: number; name: string }[]
): number[] {
  const active = new Set(customers.map((c) => c.id));
  const ids = new Set(candidateIds.filter((id) => active.has(id)));
  // The model may settle on one of several people with that name. The default-on
  // WhatsApp would then go to whoever it guessed, so anyone else the owner's own
  // search would find is offered too.
  if (spokenName) for (const c of customers) if (customerNameMatches(c.name, spokenName)) ids.add(c.id);
  return customers.filter((c) => ids.has(c.id)).map((c) => c.id); // customer-list order
}

/** The form's delivery type and date for a draft's timing, on `today`. */
export function resolveDraftTiming(
  timing: OrderDraft['timing'],
  today: string
):
  | { deliveryType: 'shabbat' | 'asap' }
  | { deliveryType: 'specific_date'; deliveryDate: string; warning?: DraftWarning }
  | null {
  if (timing.kind === 'shabbat') return { deliveryType: 'shabbat' };
  if (timing.kind === 'asap') return { deliveryType: 'asap' };
  // Not said: the form keeps its own default.
  if (timing.kind === 'none') return null;
  // An empty specific date makes the save button wait for the owner to pick one.
  if (!timing.date) return { deliveryType: 'specific_date', deliveryDate: '' };
  // The coming Friday is how the app files a שבת order.
  if (timing.date === comingFriday(today)) return { deliveryType: 'shabbat' };
  // A date that has passed since the message was read is not quietly kept.
  if (timing.date < today) {
    return { deliveryType: 'specific_date', deliveryDate: '', warning: { kind: 'date_past', date: timing.date } };
  }
  return { deliveryType: 'specific_date', deliveryDate: timing.date };
}

/** An i18n string with one placeholder filled. A function replacer, so a `$&` in what the model heard is printed as it is. */
export const fillText = (key: string, name: string, value: string) => t(key).replace(`{${name}}`, () => value);

// When the model kept no words for a warning, the wording without a quote, not an empty "".
const heardOr = (key: string, heard: string) => (heard ? fillText(key, 'heard', heard) : t(`${key}_bare`));

export function draftWarningText(w: DraftWarning): string {
  switch (w.kind) {
    case 'not_on_menu':
      return heardOr('draft.warn_not_on_menu', w.heard);
    case 'addition_dropped':
      return heardOr('draft.warn_addition_dropped', w.heard);
    case 'bad_quantity':
      return heardOr('draft.warn_bad_quantity', w.heard);
    case 'date_unclear':
      return heardOr('draft.warn_date_unclear', w.heard);
    case 'date_past':
      return fillText('draft.warn_date_past', 'date', formatDayMonth(w.date));
    case 'multiple_orders':
      return t('draft.warn_multiple_orders');
    case 'past_order_reference':
      return heardOr('draft.warn_past_order_reference', w.heard);
  }
}
