// Pinch to zoom and drag to pan the pictures, for phones and small screens.
//
// Two fingers zoom around the point between them; with the picture zoomed in, one
// finger drags it. On a computer, a trackpad pinch (ctrl + wheel) does the same.
// A tap still reaches lamps, rooms and buildings: only a drag is kept from turning
// into a click. Everything lives in one layer inside the stage, so lamps, rooms and
// taps keep lining up with the picture at any zoom.

import { el, gesture } from '../util.js';
import { t } from '../i18n.js';

const MAX = 4;
const DRAG = 8; // px a finger may move before a tap becomes a drag

export function createZoom(stage) {
  const layer = el('div', { class: 'zoom-layer' });
  const reset = el('button', { class: 'chip zoom-reset', type: 'button', hidden: true, onclick: () => set(1, 0, 0, true) }, t('app.zoomReset'));
  stage.append(layer, reset);

  let s = 1, x = 0, y = 0;
  const pointers = new Map();
  let start = null;   // gesture start: scale, translation and finger positions
  let dragging = false;
  const drag = { get on() { return dragging; }, set on(v) { dragging = v; gesture.busy = v; } };

  function clamp(scale, tx, ty) {
    const { width: w, height: h } = stage.getBoundingClientRect();
    return [Math.min(0, Math.max(w * (1 - scale), tx)), Math.min(0, Math.max(h * (1 - scale), ty))];
  }

  function set(scale, tx, ty, animate = false) {
    s = Math.min(MAX, Math.max(1, scale));
    [x, y] = s === 1 ? [0, 0] : clamp(s, tx, ty);
    layer.classList.toggle('is-animating', animate);
    layer.style.transform = s === 1 ? '' : `translate(${x}px, ${y}px) scale(${s})`;
    stage.classList.toggle('is-zoomed', s > 1);
    reset.hidden = s === 1;
  }

  // Zoom to `scale` keeping the stage point (px, py) under the same spot on the picture.
  function zoomAt(scale, px, py, from = { s, x, y }) {
    const next = Math.min(MAX, Math.max(1, scale));
    const k = next / from.s;
    set(next, px - (px - from.x) * k, py - (py - from.y) * k);
  }

  const local = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const mid = () => { const [a, b] = [...pointers.values()]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  const gap = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };

  function begin() {
    start = { s, x, y, pts: new Map(pointers) };
    if (pointers.size === 2) Object.assign(start, { mid: mid(), gap: gap() });
  }

  const opt = { capture: true };
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') { drag.on = false; return; }
    if (e.isPrimary) pointers.clear(); // first finger of a new touch: forget any lost ones
    // In placement mode a finger on a lamp drags the lamp, not the picture.
    if (document.body.classList.contains('is-editing') && e.target.closest?.('[data-drag]')) return;
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) drag.on = false;
    if (pointers.size === 2) drag.on = true; // a pinch is never a tap
    begin();
  }, opt);

  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (pointers.size >= 2 && start?.gap) {
      const [mx, my] = mid();
      const scale = start.s * (gap() / start.gap);
      // zoom around the starting midpoint, then follow the fingers as they move
      const k = Math.min(MAX, Math.max(1, scale)) / start.s;
      set(scale, mx - (start.mid[0] - start.x) * k, my - (start.mid[1] - start.y) * k);
      e.preventDefault();
    } else if (pointers.size === 1 && s > 1) {
      const [px, py] = pointers.get(e.pointerId);
      const [sx, sy] = start.pts.get(e.pointerId) ?? [px, py];
      if (!drag.on && Math.hypot(px - sx, py - sy) > DRAG) drag.on = true;
      if (drag.on) { set(s, start.x + px - sx, start.y + py - sy); e.preventDefault(); }
    }
  }, { passive: false, capture: true });

  const end = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    if (s < 1.05) set(1, 0, 0, true);
    begin(); // the remaining finger carries on from here
    // The click that follows the last finger lifting comes first; then forget the drag.
    if (!pointers.size) setTimeout(() => { drag.on = false; }, 0);
  };
  stage.addEventListener('pointerup', end, opt);
  stage.addEventListener('pointercancel', end, opt);

  // A drag or pinch must not end as a tap on whatever is under the finger.
  stage.addEventListener('click', (e) => {
    if (drag.on) { e.stopPropagation(); e.preventDefault(); drag.on = false; }
  }, true);

  // Trackpad pinch on a computer arrives as ctrl + wheel.
  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const [px, py] = local(e);
    zoomAt(s * Math.exp(-e.deltaY / 100), px, py);
  }, { passive: false });

  window.addEventListener('resize', () => set(1, 0, 0));

  return {
    layer,
    reset: () => set(1, 0, 0, true),
    get scale() { return s; },
  };
}
