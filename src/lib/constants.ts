const ORDER_STATUS_FORWARD: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['baking', 'ready', 'cancelled'],
  baking: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

/**
 * Steps back, for when a status was tapped by mistake.
 *
 * Every entry is the inverse of a forward edge above, and only of the edges
 * that fire nothing: moving into `confirmed`, `pending` or `baking` sends no
 * message and touches no money, so walking back into them is a pure field
 * flip (see the side-effect branches in src/lib/order-status.ts).
 *
 * Nothing leaves `delivered` or `cancelled`, and that is not an oversight.
 * Delivering creates a charge and, for a recurring order, next week's order;
 * cancelling tells the customer it is off. Undoing either means unwinding
 * work the world has already seen, which is a different feature from this one.
 *
 * `ready` reverses to both `confirmed` and `baking` because both lead to it —
 * bakeries that skip the baking step still get a sensible way back.
 */
export const ORDER_STATUS_REVERSALS: Record<string, string[]> = {
  confirmed: ['pending'],
  baking: ['confirmed'],
  ready: ['confirmed', 'baking'],
};

/** What the state machine will accept — forward moves plus the safe reversals. */
export const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = Object.fromEntries(
  Object.entries(ORDER_STATUS_FORWARD).map(([from, to]) => [
    from,
    [...to, ...(ORDER_STATUS_REVERSALS[from] ?? [])],
  ])
);

export const DEFAULT_BREAD_PRICE = Number(
  process.env.DEFAULT_BREAD_PRICE || '35'
);

export const INVITE_EXPIRY_DAYS = 7;

export const BALANCE_DEBT_THRESHOLD = -200;
