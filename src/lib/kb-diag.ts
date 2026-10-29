// TEMPORARY: an on-screen readout of keyboard geometry, to see what an iPhone
// reports while a field is focused. Off unless toggled by tapping a page title
// five times (stored per device). Remove once the save-bar overlap is fixed.

const KEY = 'kbdebug';

export function kbDiagOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch (e) {
    console.warn('kb-diag: localStorage unavailable', e);
    return false;
  }
}

export function toggleKbDiag(): void {
  try {
    if (kbDiagOn()) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, '1');
  } catch (e) {
    console.warn('kb-diag: could not toggle', e);
  }
  window.location.reload();
}

function panel(): HTMLPreElement {
  let el = document.getElementById('kb-diag') as HTMLPreElement | null;
  if (!el) {
    el = document.createElement('pre');
    el.id = 'kb-diag';
    el.dir = 'ltr';
    el.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:9999;margin:0;padding:4px 6px;font:10px/1.35 monospace;' +
      'background:rgba(0,0,0,.82);color:#fff;pointer-events:none;white-space:pre-wrap;max-height:45vh;overflow:hidden';
    el.textContent = '\n';
    document.body.appendChild(el);
  }
  return el;
}

/** The first line is the live state; later lines are the last few focus events. */
export function kbDiagLive(line: string): void {
  const el = panel();
  const rest = (el.textContent ?? '').split('\n').slice(1);
  el.textContent = [line, ...rest].join('\n');
}

export function kbDiagEvent(line: string): void {
  const el = panel();
  const [live, ...rest] = (el.textContent ?? '').split('\n');
  el.textContent = [live, ...rest.filter(Boolean).slice(-9), line].join('\n');
}
