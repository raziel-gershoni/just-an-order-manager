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
