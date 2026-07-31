/**
 * The *manual* reminder send — the per-customer and per-phone send buttons on
 * the customer screen, and the select-several-customers bulk blast on the
 * customer list — is parked. It wasn't earning its keep and is waiting on a
 * better idea of what it should be. The code stays in place and typechecked;
 * flip this to true and it all comes back, with nothing else to undo.
 *
 * This is deliberately narrow. Still fully live, and NOT to be gated on it:
 *
 *   · the automatic twice-weekly recurring-order reminders and their cron —
 *     these are in active use
 *   · the תזכורות tab, which is where that automation is switched on and off
 *     and where its send log lives
 *   · the per-customer opt-out, which is how a customer is excluded from the
 *     automatic sends, and the "last reminded" line that reports them
 *   · the transactional WhatsApp sends (order_received, order_ready,
 *     order_cancelled) and the per-phone bell that decides who receives them
 *
 * Typed `boolean` rather than left to infer `false` so the guarded branches
 * don't read as statically dead code.
 */
export const MANUAL_REMINDERS_ENABLED: boolean = false;
