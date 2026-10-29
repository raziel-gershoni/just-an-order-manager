'use client';

import { useEffect } from 'react';
import { isTextField, keyboardState, scrollDelta } from '@/lib/keyboard';

// Gap kept between a scrolled-to field and the header / save bar.
const MARGIN_PX = 8;
const BAR_MARGIN_PX = 12;
// Used when the keyboard was already open (field to field) so no resize comes.
const SETTLE_FALLBACK_MS = 350;

function nearestScroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

function ensureVisible(el: HTMLElement, vv: VisualViewport) {
  // The header and the save bar are sticky, so a field behind either is hidden
  // even though it is on screen. On iOS the visual viewport can also be panned
  // (offsetTop > 0) with the layout-viewport header out of sight above it.
  const header = document.querySelector<HTMLElement>('[data-sticky-header]');
  const viewTop = Math.max(header ? header.getBoundingClientRect().bottom : 0, vv.offsetTop) + MARGIN_PX;

  // Rects are relative to the layout viewport; the visible bottom is the
  // visual viewport's. A visible bar's top is exactly that bottom minus its
  // height while the keyboard is open, and also accounts for the nav when not.
  let viewBottom = vv.offsetTop + vv.height;
  for (const bar of document.querySelectorAll<HTMLElement>('[data-sticky-save]')) {
    if (bar.offsetParent === null) continue;
    viewBottom = Math.min(viewBottom, bar.getBoundingClientRect().top);
  }
  if (viewBottom < vv.offsetTop + vv.height) viewBottom -= BAR_MARGIN_PX;

  const rect = el.getBoundingClientRect();
  let target = { top: rect.top, bottom: rect.bottom };

  // A field in a section with its own inline save: keep the save button in
  // view with it, when both fit.
  const button = el
    .closest('[data-save-scope]')
    ?.querySelector<HTMLElement>('[data-save-button]');
  if (button && button.offsetParent !== null) {
    const b = button.getBoundingClientRect();
    const union = { top: Math.min(rect.top, b.top), bottom: Math.max(rect.bottom, b.bottom) };
    if (union.bottom - union.top <= viewBottom - viewTop) target = union;
  }

  const delta = scrollDelta({ target, viewTop, viewBottom });
  if (delta === 0) return;
  const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
  const scroller = nearestScroller(el);
  if (scroller) scroller.scrollBy({ top: delta, behavior });
  else window.scrollBy({ top: delta, behavior });
}

/**
 * Mirrors the on-screen keyboard onto <html> (data-keyboard, --kb-inset) so CSS
 * can hide the bottom nav and lift StickySaveBar, and scrolls a freshly focused
 * field into the part of the screen that is actually visible. Mount once.
 */
export function useKeyboardTracking() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;

    let baseline = window.innerHeight;
    let resetBaseline = false;
    let frame = 0;
    let cancelEnsure: (() => void) | null = null;

    function update() {
      baseline = Math.max(baseline, window.innerHeight);
      const { open, inset } = keyboardState({
        innerHeight: window.innerHeight,
        vvHeight: vv!.height,
        vvOffsetTop: vv!.offsetTop,
        baselineHeight: baseline,
        fieldFocused: isTextField(document.activeElement),
      });
      const state = open ? 'open' : 'closed';
      if (root.dataset.keyboard !== state) root.dataset.keyboard = state;
      const px = `${inset}px`;
      if (root.style.getPropertyValue('--kb-inset') !== px) root.style.setProperty('--kb-inset', px);
    }

    function onWindowResize() {
      // innerHeight is stale until the first resize after a rotation, so the
      // new baseline is taken here rather than in the orientationchange event.
      if (resetBaseline) {
        baseline = window.innerHeight;
        resetBaseline = false;
      }
      update();
    }

    function onOrientation() {
      baseline = 0;
      resetBaseline = true;
      update();
    }

    function onFocusIn(e: FocusEvent) {
      update();
      const el = e.target;
      if (!(el instanceof HTMLElement) || !isTextField(el)) return;
      cancelEnsure?.();
      const run = () => {
        cancel();
        if (document.activeElement === el) ensureVisible(el, vv!);
      };
      const timer = window.setTimeout(run, SETTLE_FALLBACK_MS);
      const cancel = () => {
        window.clearTimeout(timer);
        vv!.removeEventListener('resize', run);
        cancelEnsure = null;
      };
      vv!.addEventListener('resize', run);
      cancelEnsure = cancel;
    }

    function onFocusOut() {
      // activeElement is body during focusout; it is the next field one frame later.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('orientationchange', onOrientation);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      cancelEnsure?.();
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('orientationchange', onOrientation);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      delete root.dataset.keyboard;
      root.style.removeProperty('--kb-inset');
    };
  }, []);
}
