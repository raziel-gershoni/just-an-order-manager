/**
 * Names go onto plain-text cards: a line break in one could fake a line of the
 * card. Format characters (\p{Cf}) include the bidi overrides and isolates: one
 * at the end of a name would reorder the rest of its card line.
 */
export const hasControlChars = (s: string) => /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(s);
