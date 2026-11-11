// Small DOM/SVG helpers shared by all views. No dependencies.

export const SVGNS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, ...kids) {
  return make(document.createElement(tag), attrs, kids);
}

export function sv(tag, attrs = {}, ...kids) {
  return make(document.createElementNS(SVGNS, tag), attrs, kids);
}

function make(node, attrs, kids) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const pts = (poly) => poly.map((p) => p.join(',')).join(' ');

// Area-weighted centroid of a polygon [[x,y],...]
export function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

// Ray casting: is [x, y] inside the polygon?
export function inside([x, y], poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function bbox(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polys) for (const [x, y] of poly) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Number formats are slow to create, so each locale and precision is made once.
const formats = new Map();
export function fmt(v, digits = 1, locale = 'sv-SE') {
  if (v == null || !Number.isFinite(v)) return '–';
  const key = `${locale}|${digits}`;
  let f = formats.get(key);
  if (!f) formats.set(key, (f = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })));
  return f.format(v);
}

export function hhmm(iso, locale = 'sv-SE') {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d)) return '–';
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

// Animations and timers rest while the page is hidden or the night dim covers it
// (body.is-dimmed, see ui/wall.js). Light mode stops the SVG animations for good.
export const paused = () => document.hidden || !!document.body?.classList.contains('is-dimmed');

export function syncPause() {
  const body = document.body;
  if (!body) return;
  const was = body.classList.contains('is-paused');
  const now = paused();
  body.classList.toggle('is-paused', now);
  const still = now || body.classList.contains('is-lite');
  for (const svg of document.querySelectorAll('svg.ov-upper')) {
    if (still) svg.pauseAnimations?.(); else svg.unpauseAnimations?.();
  }
  if (was && !now) document.dispatchEvent(new Event('shd:resume'));
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Also true in light mode (body.is-lite, see ui/wall.js), which drops animation altogether.
export const reducedMotion = () =>
  document.body?.classList.contains('is-lite') || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

export const storage = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* storage unavailable */ }
  },
};

// Short press / long press on one element. Long press also fires on right-click.
// Set while a pinch or drag on the pictures is going on (see ui/zoom.js), so a finger
// lifting at the end of it does not also switch the lamp under it.
export const gesture = { busy: false };

export function press(node, onShort, onLong, ms = 450) {
  let timer = null, fired = false, from = null;
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    fired = false;
    from = [e.clientX, e.clientY];
    timer = setTimeout(() => { if (gesture.busy) return; fired = true; onLong?.(e); }, ms);
  });
  const cancel = () => { clearTimeout(timer); timer = null; };
  node.addEventListener('pointermove', (e) => {
    if (timer && from && Math.hypot(e.clientX - from[0], e.clientY - from[1]) > 8) cancel();
  });
  node.addEventListener('pointerup', (e) => {
    if (timer && !fired && !gesture.busy) { cancel(); onShort?.(e); }
    cancel();
  });
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); onLong?.(e); });
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onShort?.(e); }
  });
  node.addEventListener('click', (e) => e.stopPropagation());
}

// Coordinates of a pointer event in an SVG's own user space.
export function svgPoint(svg, e) {
  const p = svg.createSVGPoint();
  p.x = e.clientX; p.y = e.clientY;
  const m = svg.getScreenCTM();
  return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 };
}

let uid = 0;
export const nextId = (prefix) => `${prefix}-${++uid}`;

// ---------- shape editing (setup guide and placement mode)

// The point on segment a–b nearest to p.
function nearestOnSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const k = len ? clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1) : 0;
  return [ax + k * dx, ay + k * dy];
}

// Snap a point to the nearest corner of the other shapes within r, or else to the
// nearest point on one of their edges within r. Returns { at, to } where `to` is
// 'corner', 'edge' or null (not snapped, `at` is p).
export function snapPoint(p, polys, r) {
  let best = null, dist = r;
  for (const poly of polys) for (const q of poly) {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d <= dist) { dist = d; best = q; }
  }
  if (best) return { at: [best[0], best[1]], to: 'corner' };
  dist = r;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const q = nearestOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= dist) { dist = d; best = q; }
    }
  }
  return best ? { at: best, to: 'edge' } : { at: p, to: null };
}

// For a whole shape being moved: the smallest shift that puts one of its corners on a
// corner of another shape, within r. [0, 0] when nothing is that close.
export function snapShift(poly, polys, r) {
  let best = [0, 0], dist = r;
  for (const c of poly) for (const other of polys) for (const q of other) {
    const d = Math.hypot(q[0] - c[0], q[1] - c[1]);
    if (d <= dist) { dist = d; best = [q[0] - c[0], q[1] - c[1]]; }
  }
  return best;
}

// Undo and redo over snapshots. `push(state)` records the state as it was before a
// change; `undo(now)` and `redo(now)` take the current state and return the one to go
// back to (or null). States are kept as given, so pass copies or JSON strings.
export function createHistory({ limit = 50, undo = [], redo = [] } = {}) {
  const h = {
    undo: [...undo], redo: [...redo],
    push(state) { h.undo.push(state); if (h.undo.length > limit) h.undo.shift(); h.redo = []; },
    back(now) { if (!h.undo.length) return null; h.redo.push(now); return h.undo.pop(); },
    forward(now) { if (!h.redo.length) return null; h.undo.push(now); return h.redo.pop(); },
    clear() { h.undo = []; h.redo = []; },
  };
  return h;
}

// Keyboard shortcuts for undo and redo: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y.
// Text fields keep their own undo.
export const typing = (e) => !!e.target?.closest?.('input, textarea, select, [contenteditable="true"]');
export function undoKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || typing(e)) return null;
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !e.shiftKey) return 'redo';
  return null;
}
// Arrow key as a step [dx, dy]; Shift moves ten steps.
export function arrowStep(e, step = 1) {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!d || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return null;
  const n = step * (e.shiftKey ? 10 : 1);
  return [d[0] * n, d[1] * n];
}
