/**
 * Escape text going into a Telegram message sent with parse_mode: 'HTML'.
 *
 * Telegram rejects the whole message when a stray `<` or `&` breaks its parser,
 * and the sends here batch a week of orders or a list of debtors into one — so
 * one customer named "דנה & רון" silently costs the entire digest. The catch
 * around each send only warns, so nobody is told it happened; it just stops
 * arriving, every week, until the name is edited.
 *
 * Apply it to anything a person typed: customer names, bread and ingredient
 * names, order notes. NOT to button labels (they are plain text and would show
 * the entities literally), and not to the `<b>` tags the callers add on purpose.
 *
 * Lives in its own module because both the pure recipe formatter and the
 * messaging layer need it, and recipe.ts must not pull the bot and the database
 * into the client bundle to get it.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
