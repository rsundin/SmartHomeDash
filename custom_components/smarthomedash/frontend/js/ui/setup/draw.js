// Setup guide: drawing a polygon (or picking a point) on a picture, and the buttons
// that open it or the shape editor (ui/shape.js).

import { el, sv, pts, svgPoint, centroid, snapPoint } from '../../util.js';
import { editShape, snapToggle, snapOn, snapRadius } from '../shape.js';
import { t } from '../../i18n.js';

export function createDrawing(ctx) {
  const { changed, render, root, select } = ctx;
  function drawButton(label, opts, onDone) {
    return el('button', { class: 'chip', type: 'button', onclick: () => draw({ ...opts, title: label }, (poly, picked) => { onDone(poly, picked); changed(); render(); }) }, label);
  }

  // Move a shape's corners, add and remove corners, or move all of it (ui/shape.js).
  function shapeButton(label, opts, onDone) {
    return el('button', { class: 'chip setup-shape', type: 'button', 'aria-label': label, onclick: () => {
      root.append(editShape({ ...opts, title: label }, (poly, shift) => { onDone(poly, shift); changed(); render(); }));
    } }, t('setup.editShape'));
  }

  function draw({ src, size: [w, h], shapes, title, point = false, pick = null }, onDone) {
    // pick = { label, options: [[value, text]] }: chosen while drawing, handed to onDone.
    const picker = pick ? select(pick.options, '', () => {}, { 'aria-label': pick.label }) : null;
    let points = [];
    const live = sv('polyline', { class: 'draw-live' });
    const dots = sv('g', { class: 'draw-dots' });
    const scale = Math.max(w, h) / 160;
    const svgEl = sv('svg', { viewBox: `0 0 ${w} ${h}`, class: 'draw-svg', preserveAspectRatio: 'xMidYMid meet' },
      sv('image', { href: src, width: w, height: h }),
      shapes.map((s) => sv('g', { class: `draw-shape draw-${s.kind}` },
        sv('polygon', { points: pts(s.points), 'stroke-width': scale * 0.35 }),
        s.label ? sv('text', { x: centroid(s.points)[0], y: centroid(s.points)[1], 'font-size': scale * 2.4, 'text-anchor': 'middle' }, s.label) : null)),
      live, dots);
    live.setAttribute('stroke-width', scale * 0.45);
    const count = el('span', { class: 'muted small' });
    const doneBtn = el('button', { class: 'chip chip-primary', type: 'button', disabled: true }, t('setup.drawDone'));
    const redraw = () => {
      live.setAttribute('points', pts(points.length > 2 ? [...points, points[0]] : points));
      dots.replaceChildren(...points.map(([x, y]) => sv('circle', { cx: x, cy: y, r: scale * 0.9 })));
      count.textContent = t('setup.drawCount', { n: points.length });
      doneBtn.disabled = points.length < 3;
    };
    svgEl.addEventListener('click', (e) => {
      const p = svgPoint(svgEl, e);
      if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) return;
      // With Snap on, a corner lands on a nearby corner or edge of what is already drawn.
      const at = snapOn() ? snapPoint([p.x, p.y], shapes.map((s) => s.points).filter((q) => q?.length > 2), snapRadius(svgEl)).at : [p.x, p.y];
      points.push([Math.round(at[0]), Math.round(at[1])]);
      if (point) { overlay.remove(); onDone(points, picker?.value); return; }
      redraw();
    });
    const overlay = el('div', { class: 'draw' },
      el('div', { class: 'draw-bar' },
        el('div', {}, el('strong', {}, title), el('p', { class: 'muted small' }, t(point ? 'setup.pointHelp' : 'setup.drawHelp'))),
        el('div', { class: 'row' }, picker ? el('label', { class: 'draw-pick' }, el('span', { class: 'small muted' }, pick.label), picker) : null,
          point ? null : snapToggle(), count,
          el('button', { class: 'chip', type: 'button', onclick: () => { points.pop(); redraw(); } }, t('editor.undo')),
          el('button', { class: 'chip', type: 'button', onclick: () => overlay.remove() }, t('setup.cancel')),
          doneBtn)),
      el('div', { class: 'draw-stage' }, svgEl));
    doneBtn.addEventListener('click', () => { overlay.remove(); onDone(points, picker?.value); });
    redraw();
    root.append(overlay);
  }

  return { drawButton, shapeButton, draw };
}
