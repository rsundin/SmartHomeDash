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

export function fmt(v, digits = 1, locale = 'sv-SE') {
  if (v == null || !Number.isFinite(v)) return '–';
  return v.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function hhmm(iso, locale = 'sv-SE') {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d)) return '–';
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

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
export function press(node, onShort, onLong, ms = 450) {
  let timer = null, fired = false;
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    fired = false;
    timer = setTimeout(() => { fired = true; onLong?.(e); }, ms);
  });
  const cancel = () => { clearTimeout(timer); timer = null; };
  node.addEventListener('pointerup', (e) => {
    if (timer && !fired) { cancel(); onShort?.(e); }
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
