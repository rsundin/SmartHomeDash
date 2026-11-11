// Edit a drawn shape (a room or a building) on its picture, from the setup guide.
//
//   drag a corner           moves it (snapping to other shapes when Snap is on)
//   drag an edge's marker   adds a corner there
//   long press a corner     removes it (right-click too, or Delete on the selected one)
//   drag inside the shape   moves all of it
//   arrow keys              nudge the selected corner, or the shape; Shift ten times as far
//   Ctrl/Cmd+Z, Shift+Z     undo and redo inside the editor
//
// Nothing changes until Done: onDone(points, shift) gets the new corners and how far
// the shape as a whole was moved, so what sits inside it (lamps) can move along.

import { el, sv, pts, svgPoint, centroid, storage, snapPoint, snapShift, createHistory, undoKey, arrowStep } from '../util.js';
import { t } from '../i18n.js';

const SNAP_KEY = 'shd:snap';
const LONG_PRESS = 600;
export const snapOn = () => storage.get(SNAP_KEY, true) !== false;

// The Snap toggle, shared by drawing and editing; remembered in this browser.
export function snapToggle(onChange = () => {}) {
  const box = el('input', { type: 'checkbox', checked: snapOn() });
  box.addEventListener('change', () => { storage.set(SNAP_KEY, box.checked); onChange(box.checked); });
  return el('label', { class: 'draw-pick draw-snap' }, box, el('span', { class: 'small' }, t('shape.snap')));
}

// Snap distance: about 14 screen pixels, in the picture's own units.
export const snapRadius = (svg) => 14 / Math.abs(svg.getScreenCTM()?.a || 1);

export function editShape({ src, size: [w, h], shapes, points, title, step = 1, kind = 'room' }, onDone) {
  const others = shapes.map((s) => s.points).filter((p) => p?.length > 2);
  let poly = points.map(([x, y]) => [x, y]);
  let shift = [0, 0];
  let sel = null; // { corner: i } or { body: true }
  const history = createHistory({ limit: 100 });
  const snapshot = () => JSON.stringify({ poly, shift });
  const restore = (s) => { ({ poly, shift } = JSON.parse(s)); if (sel?.corner >= poly.length) sel = null; redraw(); };
  const record = () => { history.push(snapshot()); };

  const scale = Math.max(w, h) / 160;
  const shape = sv('polygon', { class: 'shape-body', 'stroke-width': scale * 0.45 });
  const mids = sv('g', { class: 'shape-mids' });
  const corners = sv('g', { class: 'shape-corners' });
  const svgEl = sv('svg', { viewBox: `0 0 ${w} ${h}`, class: 'draw-svg shape-svg', preserveAspectRatio: 'xMidYMid meet', tabindex: 0, 'aria-label': title },
    sv('image', { href: src, width: w, height: h }),
    shapes.map((s) => sv('g', { class: `draw-shape draw-${s.kind}` },
      sv('polygon', { points: pts(s.points), 'stroke-width': scale * 0.35 }),
      s.label ? sv('text', { x: centroid(s.points)[0], y: centroid(s.points)[1], 'font-size': scale * 2.4, 'text-anchor': 'middle' }, s.label) : null)),
    shape, mids, corners);
  const msg = el('span', { class: 'muted small shape-msg', role: 'status' });
  const undoBtn = el('button', { class: 'chip', type: 'button', onclick: () => undo() }, t('history.undo'));
  const redoBtn = el('button', { class: 'chip', type: 'button', onclick: () => redo() }, t('history.redo'));
  const doneBtn = el('button', { class: 'chip chip-primary', type: 'button', onclick: () => finish() }, t('setup.drawDone'));
  const overlay = el('div', { class: `draw shape-edit shape-${kind}` },
    el('div', { class: 'draw-bar' },
      el('div', {}, el('strong', {}, title), el('p', { class: 'muted small' }, t('shape.help'))),
      el('div', { class: 'row' }, snapToggle(), msg, undoBtn, redoBtn,
        el('button', { class: 'chip', type: 'button', onclick: () => close() }, t('setup.cancel')),
        doneBtn)),
    el('div', { class: 'draw-stage' }, svgEl));

  function redraw() {
    shape.setAttribute('points', pts(poly));
    shape.classList.toggle('is-selected', !!sel?.body);
    corners.replaceChildren(...poly.map(([x, y], i) => sv('circle', {
      class: `shape-corner${sel?.corner === i ? ' is-selected' : ''}`, cx: x, cy: y, r: scale * 1.2, 'stroke-width': scale * 0.3, 'data-i': i,
    })));
    mids.replaceChildren(...poly.map(([x, y], i) => {
      const [x2, y2] = poly[(i + 1) % poly.length];
      return sv('circle', { class: 'shape-mid', cx: (x + x2) / 2, cy: (y + y2) / 2, r: scale * 0.75, 'data-i': i });
    }));
    undoBtn.disabled = !history.undo.length;
    redoBtn.disabled = !history.redo.length;
  }
  const round = (p) => [Math.round(p[0]), Math.round(p[1])];
  const inBounds = ([x, y]) => [Math.min(Math.max(x, 0), w), Math.min(Math.max(y, 0), h)];

  function removeCorner(i) {
    if (poly.length <= 3) { msg.textContent = t('shape.minCorners'); return false; }
    record();
    poly.splice(i, 1);
    sel = null;
    msg.textContent = t('shape.removed');
    redraw();
    return true;
  }

  // ---------- pointer: corners, edge markers and the body
  let drag = null;
  svgEl.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const p = svgPoint(svgEl, e);
    const target = e.target;
    const before = snapshot();
    if (target.classList.contains('shape-corner')) {
      const i = Number(target.dataset.i);
      sel = { corner: i };
      drag = { kind: 'corner', i, before, from: [e.clientX, e.clientY], moved: false };
      drag.timer = setTimeout(() => { if (drag && !drag.moved) { const d = drag; drag = null; if (!removeCorner(d.i)) redraw(); } }, LONG_PRESS);
    } else if (target.classList.contains('shape-mid')) {
      const i = Number(target.dataset.i) + 1;
      poly.splice(i, 0, round([Number(target.getAttribute('cx')), Number(target.getAttribute('cy'))]));
      sel = { corner: i };
      drag = { kind: 'corner', i, before, from: [e.clientX, e.clientY], moved: true, added: true };
    } else if (target === shape) {
      sel = { body: true };
      drag = { kind: 'body', before, start: [p.x, p.y], orig: poly.map((q) => [...q]), shift0: [...shift], from: [e.clientX, e.clientY], moved: false };
    } else {
      sel = null;
      redraw();
      return;
    }
    e.preventDefault();
    svgEl.setPointerCapture?.(e.pointerId);
    svgEl.focus({ preventScroll: true });
    redraw();
  });
  svgEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.from[0], e.clientY - drag.from[1]) < 6) return;
      drag.moved = true;
      clearTimeout(drag.timer);
    }
    const p = svgPoint(svgEl, e);
    const r = snapOn() ? snapRadius(svgEl) : 0;
    if (drag.kind === 'corner') {
      const snapped = r ? snapPoint(inBounds([p.x, p.y]), others, r) : { at: inBounds([p.x, p.y]), to: null };
      poly[drag.i] = round(snapped.at);
      msg.textContent = snapped.to ? t(`shape.snapped.${snapped.to}`) : '';
    } else {
      const d = [p.x - drag.start[0], p.y - drag.start[1]];
      const moved = drag.orig.map(([x, y]) => [x + d[0], y + d[1]]);
      const extra = r ? snapShift(moved, others, r) : [0, 0];
      const total = round([d[0] + extra[0], d[1] + extra[1]]);
      poly = drag.orig.map(([x, y]) => [x + total[0], y + total[1]]);
      shift = [drag.shift0[0] + total[0], drag.shift0[1] + total[1]];
      msg.textContent = extra[0] || extra[1] ? t('shape.snapped.corner') : '';
    }
    redraw();
  });
  const end = () => {
    if (!drag) return;
    clearTimeout(drag.timer);
    if (drag.moved && snapshot() !== drag.before) history.push(drag.before);
    drag = null;
    redraw();
  };
  svgEl.addEventListener('pointerup', end);
  svgEl.addEventListener('pointercancel', () => {
    if (!drag) return;
    clearTimeout(drag.timer);
    restore(drag.before);
    drag = null;
  });
  svgEl.addEventListener('contextmenu', (e) => {
    if (!e.target.classList.contains('shape-corner')) return;
    e.preventDefault();
    if (drag) { clearTimeout(drag.timer); drag = null; }
    removeCorner(Number(e.target.dataset.i));
  });

  // ---------- keyboard
  function nudge([dx, dy]) {
    if (!sel) { sel = { body: true }; }
    record();
    if (sel.body) {
      poly = poly.map(([x, y]) => [x + dx, y + dy]);
      shift = [shift[0] + dx, shift[1] + dy];
    } else {
      poly[sel.corner] = inBounds([poly[sel.corner][0] + dx, poly[sel.corner][1] + dy]);
    }
    redraw();
  }
  function undo() { const s = history.back(snapshot()); if (s) { restore(s); msg.textContent = t('history.undone'); } }
  function redo() { const s = history.forward(snapshot()); if (s) { restore(s); msg.textContent = t('history.redone'); } }
  const onKey = (e) => {
    if (!overlay.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
    const u = undoKey(e);
    if (u) { e.preventDefault(); e.stopPropagation(); if (u === 'undo') undo(); else redo(); return; }
    const d = arrowStep(e, step);
    if (d) { e.preventDefault(); e.stopPropagation(); nudge(d); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel?.corner != null && !e.target.closest?.('input, select, textarea')) {
      e.preventDefault(); removeCorner(sel.corner); return;
    }
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', onKey, true);

  function close() { overlay.remove(); document.removeEventListener('keydown', onKey, true); }
  function finish() { close(); onDone(poly.map(round), shift); }

  redraw();
  return overlay;
}
