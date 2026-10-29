/**
 * What the new-order form starts from when it is opened with something already
 * known: a saved order ("הזמן שוב") or an order read from a message (a draft).
 * Both become one patch, so the form applies them the same way. Pure and
 * client-safe: no I/O, the caller passes in what the form has loaded.
 */

import { copyLinesToMenu, type CopiedLine, type MenuType, type SourceLine } from '@/lib/order-copy';
import {
  draftWarningText,
  resolveCustomerCandidates,
  resolveDraftTiming,
  type OrderDraft,
} from '@/lib/order-draft-types';
import { t } from '@/lib/i18n';

export type FormDeliveryType = 'shabbat' | 'asap' | 'specific_date' | 'weekly';

export interface CopySource {
  id: number;
  customerId: number;
  deliveryType: string;
  deliveryDate: string | null;
  notes: string | null;
  isDelivery?: boolean;
  deliveryFee?: string | number | null;
  totalOverride?: string | null;
  dealsEnabled?: boolean;
  additionsCharged?: boolean;
  items: SourceLine[];
}

export type PrefillSource =
  | { kind: 'copy'; order: CopySource }
  | { kind: 'draft'; code: string; transcript: string; draft: OrderDraft };

export interface PrefillEnv {
  customers: { id: number; name: string }[];
  breadTypes: MenuType[];
  deliveryEnabled: boolean;
  today: string;
}

/** Hold the stated pickup/delivery choice: until the customer changes from `anchor`; with `anchor` null, the first pick becomes the anchor. */
export interface PrefillHold {
  anchor: number | null;
}

export interface PrefillPatch {
  items: CopiedLine[];
  customerId?: number;
  hold: PrefillHold | null;
  isDelivery?: boolean;
  deliveryManualFee?: string;
  dealsEnabled?: boolean;
  additionsCharged?: boolean;
  totalOverride?: string;
  notes?: string;
  deliveryType?: FormDeliveryType;
  deliveryDate?: string;
  isRecurring?: boolean;
  customerSearch?: string;
  newCustomerName?: string;
  showNewCustomer?: boolean;
  quickPicks?: number[];
  banner:
    | { kind: 'copy'; id: number; date: string | null; customerId: number; dropped: boolean; none: boolean; droppedTotal: boolean }
    | { kind: 'draft'; transcript: string; warnings: string[] };
}

/** A positive amount as the form's text field holds it, else empty. */
export function money(v: string | number | null | undefined): string {
  return v != null && Number(v) > 0 ? String(Number(v)) : '';
}

function prefillFromCopy(src: CopySource, env: PrefillEnv): PrefillPatch {
  const copied = copyLinesToMenu(src.items, env.breadTypes);
  // A customer deactivated since is left for the owner to pick: the
  // form knows only listed customers' phones and city, which the
  // WhatsApp checkbox and the delivery fee go by.
  const listed = env.customers.some((x) => x.id === src.customerId);
  // Only while delivery is still offered: with it switched off the
  // delivery card is hidden, and nothing could take it back off.
  const delivery = Boolean(src.isDelivery) && env.deliveryEnabled;
  // A custom total priced that basket; with part of it gone it would
  // price something else.
  const customTotal = src.totalOverride != null && Number(src.totalOverride) > 0;
  return {
    customerId: listed ? src.customerId : undefined,
    hold: { anchor: src.customerId },
    isDelivery: delivery,
    deliveryManualFee: delivery ? money(src.deliveryFee) : '',
    dealsEnabled: src.dealsEnabled ?? true,
    additionsCharged: src.additionsCharged ?? true,
    totalOverride: customTotal && !copied.dropped ? String(Number(src.totalOverride)) : '',
    notes: src.notes || '',
    deliveryType: src.deliveryType as FormDeliveryType,
    // Nothing left is left empty, not filled with a bread nobody chose.
    items: copied.lines,
    banner: {
      kind: 'copy',
      id: src.id,
      date: src.deliveryDate ?? null,
      customerId: src.customerId,
      dropped: copied.dropped,
      none: copied.lines.length === 0,
      droppedTotal: customTotal && copied.dropped,
    },
  };
}

function prefillFromDraft(source: Extract<PrefillSource, { kind: 'draft' }>, env: PrefillEnv): PrefillPatch {
  const { draft } = source;
  const spoken = draft.customer.spokenName;
  const warnings = draft.warnings.map(draftWarningText);
  const patch: Partial<PrefillPatch> = {};

  // Re-resolved at open: the customers may have changed since the message was read.
  const candidates = resolveCustomerCandidates(spoken, draft.customer.candidateIds, env.customers);
  // Selected only when the model itself named the one customer and the picker's
  // search finds no other. A customer only the name search found is offered, not
  // chosen, since the default-on WhatsApp would go to a guess.
  if (candidates.length === 1 && draft.customer.candidateIds.includes(candidates[0])) {
    patch.customerId = candidates[0];
  } else if (candidates.length > 0) {
    patch.quickPicks = candidates;
    patch.customerSearch = spoken ?? '';
  } else if (spoken) {
    patch.customerSearch = spoken;
    patch.showNewCustomer = true;
    patch.newCustomerName = spoken;
  }

  // A stated choice is held only while delivery is still offered.
  const delivery = draft.delivery != null && env.deliveryEnabled ? draft.delivery : undefined;
  const hold: PrefillHold | null = delivery !== undefined ? { anchor: patch.customerId ?? null } : null;
  if (delivery !== undefined) patch.isDelivery = delivery;

  const timing = resolveDraftTiming(draft.timing, env.today);
  if (timing) {
    patch.deliveryType = timing.deliveryType;
    if (timing.deliveryType === 'specific_date') {
      patch.deliveryDate = timing.deliveryDate;
      if (timing.warning) warnings.push(draftWarningText(timing.warning));
    }
  }
  // The form offers no repeat for בהקדם.
  if (draft.recurring === true && timing?.deliveryType !== 'asap') patch.isRecurring = true;

  const copied = copyLinesToMenu(
    draft.lines.map((l) => ({
      breadTypeId: l.breadTypeId,
      breadSizeId: l.breadSizeId,
      quantity: l.quantity,
      additions: l.breadAdditionIds.map((id) => ({ id })),
    })),
    env.breadTypes
  );
  if (copied.dropped) warnings.push(t('draft.warn_menu_changed'));

  if (draft.notes != null) patch.notes = draft.notes;

  return {
    ...patch,
    items: copied.lines,
    hold,
    banner: { kind: 'draft', transcript: source.transcript, warnings },
  };
}

export function buildPrefill(source: PrefillSource, env: PrefillEnv): PrefillPatch {
  return source.kind === 'copy' ? prefillFromCopy(source.order, env) : prefillFromDraft(source, env);
}
