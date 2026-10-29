'use client';

import { useEffect } from 'react';
import { isTextField, keyboardState, scrollDelta } from '@/lib/keyboard';
import { kbDiagEvent, kbDiagLive, kbDiagOn } from '@/lib/kb-diag';

// Gap kept between a scrolled-to field and the header / save bar.
const MARGIN_PX = 8;
const BAR_MARGIN_PX = 12;
// Used when the keyboard was already open (field to field) so no resize comes.
const SETTLE_FALLBACK_MS = 350;
// Quiet time after the last viewport resize before the keyboard counts as settled.
const RESIZE_SETTLE_MS = 120;

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
  if (kbDiagOn()) {
    const bar = document.querySelector<HTMLElement>('[data-sticky-save]');
    const br = bar && bar.offsetParent !== null ? bar.getBoundingClientRect() : null;
    const n = Math.round;
    const scr = nearestScroller(el) ? 'el' : 'win';
    kbDiagEvent(`focus f=${n(rect.top)}..${n(rect.bottom)} bar=${br ? n(br.top) + '..' + n(br.bottom) : '-'} hdr=${header ? n(header.getBoundingClientRect().bottom) : '-'} vT=${n(viewTop)} vB=${n(viewBottom)} d=${n(delta)} ${scr} sy=${n(window.scrollY)} vvo=${n(vv.offsetTop)} vvh=${n(vv.height)} ih=${window.innerHeight}`);
    window.setTimeout(() => {
      const r2 = el.getBoundingClientRect();
      const b2 = bar && bar.offsetParent !== null ? bar.getBoundingClientRect() : null;
      kbDiagEvent(`after f=${n(r2.top)}..${n(r2.bottom)} bar=${b2 ? n(b2.top) + '..' + n(b2.bottom) : '-'} sy=${n(window.scrollY)} vvo=${n(vv.offsetTop)} vvh=${n(vv.height)} sh=${document.documentElement.scrollHeight}`);
    }, 700);
  }
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
    let settle = 0;

    // Places the focused field once the screen stops changing size. Telegram on
    // iOS shrinks the whole page some time after the field is focused (later
    // than any fixed wait), and Android resizes once per animation frame, so
    // this re-arms on every resize while a field is focused instead of firing
    // once at focus time and missing the resize that matters.
    function scheduleEnsure(delay: number) {
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        const el = document.activeElement;
        if (el instanceof HTMLElement && isTextField(el)) ensureVisible(el, vv!);
      }, delay);
    }

    function onViewportResize() {
      update();
      if (isTextField(document.activeElement)) scheduleEnsure(RESIZE_SETTLE_MS);
    }

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
      if (kbDiagOn()) {
        kbDiagLive(`live ih=${window.innerHeight} vvh=${Math.round(vv!.height)} vvo=${Math.round(vv!.offsetTop)} sy=${Math.round(window.scrollY)} inset=${inset} ${state}`);
      }
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
      if (isTextField(document.activeElement)) scheduleEnsure(RESIZE_SETTLE_MS);
    }

    function onOrientation() {
      baseline = 0;
      resetBaseline = true;
      update();
    }

    function onFocusIn(e: FocusEvent) {
      update();
      // Moving between fields with the keyboard already up brings no resize, so
      // a focus also places the field on its own after a short wait.
      if (isTextField(e.target as Element | null)) scheduleEnsure(SETTLE_FALLBACK_MS);
    }

    function onFocusOut() {
      // activeElement is body during focusout; it is the next field one frame later.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }

    update();
    vv.addEventListener('resize', onViewportResize);
    vv.addEventListener('scroll', update);
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('orientationchange', onOrientation);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      window.clearTimeout(settle);
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', onViewportResize);
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
