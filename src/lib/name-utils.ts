/** Get the display initial for an avatar. If name starts with משפחה/משפ׳/משפ, use last word's first letter. */
export function getInitial(name: string): string {
  const trimmed = name.trim();
  const words = trimmed.split(/\s+/);
  if (words.length > 1) {
    const first = words[0];
    if (first === 'משפחה' || first === "משפ'" || first === 'משפ׳' || first === 'משפ') {
      return words[words.length - 1].charAt(0);
    }
  }
  return trimmed.charAt(0);
}

const FAMILY_PREFIXES = ['משפחה', "משפ'", 'משפ׳', 'משפ'];

/** Split a customer name into first/family. "משפ׳ X" → { first: '', last: 'X' }. */
export function inferName(name: string): { first: string; last: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { first: '', last: '' };
  if (words.length > 1 && FAMILY_PREFIXES.includes(words[0])) {
    return { first: '', last: words.slice(1).join(' ') };
  }
  if (words.length === 1) return { first: words[0], last: '' };
  return { first: words[0], last: words.slice(1).join(' ') };
}

/**
 * Contact first/last name for one phone: the number's own name (if set) is the
 * first name + the customer's family name as last; otherwise the customer's own
 * inferred first/last. Always returns a non-empty firstName (Telegram requires it).
 */
export function phoneContactName(
  customerName: string,
  phoneName?: string | null
): { firstName: string; lastName: string } {
  const { first, last } = inferName(customerName);
  const label = phoneName?.trim();
  if (label) return { firstName: label, lastName: last };
  if (first) return { firstName: first, lastName: last };
  return { firstName: last || customerName.trim(), lastName: '' };
}
