// Pure helpers behind useKeyboardTracking: kept free of the DOM so the maths
// (is the on-screen keyboard open, how much does it cover, how far to scroll a
// field into view) can be checked without a browser.

// A soft keyboard is never this short; anything smaller is browser chrome
// (address bar collapsing, a toolbar) moving the viewport.
const MIN_KEYBOARD_PX = 100;

export interface ViewportMetrics {
  innerHeight: number;
  vvHeight: number;
  vvOffsetTop: number;
  /** Tallest innerHeight seen since load / the last rotation. */
  baselineHeight: number;
  fieldFocused: boolean;
}

/**
 * Two browsers, two behaviours. iOS overlays the keyboard: the layout viewport
 * keeps its height and only the visual viewport shrinks, so the covered strip
 * is `innerHeight - vvHeight - vvOffsetTop`. Android resizes the layout
 * viewport itself, so the visual viewport still matches it and the only trace
 * is `innerHeight` dropping below the baseline. A focused text field is
 * required either way: without one, a shrink is pinch-zoom or browser chrome,
 * not a keyboard. `inset` is how far a bottom-anchored bar must be lifted, so
 * it is 0 in the Android case (the bar already sits on the resized viewport).
 */
export function keyboardState(m: ViewportMetrics): { open: boolean; inset: number } {
  const inset = Math.max(0, Math.round(m.innerHeight - m.vvHeight - m.vvOffsetTop));
  const shrunk = m.baselineHeight - m.innerHeight;
  const open = m.fieldFocused && (inset > MIN_KEYBOARD_PX || shrunk > MIN_KEYBOARD_PX);
  return { open, inset: open ? inset : 0 };
}

/** The slice of an element isTextField reads; lets tests pass a plain object. */
export interface FieldLike {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
}

// Inputs that never raise a text keyboard.
const NON_TEXT_INPUTS = new Set([
  'checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'color', 'hidden',
]);

/** True for fields that bring up the on-screen keyboard (or a picker, for select). */
export function isTextField(el: FieldLike | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((el.type ?? 'text').toLowerCase());
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable === true;
}

export interface ScrollInput {
  target: { top: number; bottom: number };
  /** Visible band, same coordinate space as target. */
  viewTop: number;
  viewBottom: number;
}

/**
 * How far to scroll (positive = down) so the target sits inside the band.
 * A target taller than the band can't fit, so its top is aligned instead:
 * the start of a long textarea matters more than its end.
 */
export function scrollDelta({ target, viewTop, viewBottom }: ScrollInput): number {
  if (target.bottom - target.top > viewBottom - viewTop) return target.top - viewTop;
  if (target.bottom > viewBottom) return target.bottom - viewBottom;
  if (target.top < viewTop) return target.top - viewTop;
  return 0;
}
