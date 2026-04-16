export const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['baking', 'ready', 'cancelled'],
  baking: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export const DEFAULT_BREAD_PRICE = Number(
  process.env.DEFAULT_BREAD_PRICE || '35'
);

export const INVITE_EXPIRY_DAYS = 7;

export const BALANCE_DEBT_THRESHOLD = -200;
