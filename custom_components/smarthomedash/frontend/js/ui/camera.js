// Cameras: the camera window (shared by the doorbell and cameras placed on the picture)
// and the camera markers drawn on floor plans and the overview.
//
// On a floor plan:   "cameras": [{ "entity": "camera.garden", "at": [x, y], "angle": 200, "motion": "binary_sensor.garden_motion" }]
// On the overview:   "overview": { "cameras": [ ...the same, in image pixels ] }
//
// `angle` (degrees, 0 = right, 90 = down) draws a field-of-view wedge that turns red while
// `motion` is on, or while the camera itself reports `motion_detected`. Without `angle`,
// only the camera icon is drawn. The picture comes through Home Assistant's camera proxy
// with the viewer's own login: live (MJPEG) where Home Assistant streams it, otherwise a
// still every two seconds; stills only in light mode.

import { el, sv } from '../util.js';
import { nameOf } from '../entities.js';
import { t } from '../i18n.js';

let current = null;

export function cameraUrl(store, adapter, id, stream) {
  const pic = store.get(id)?.attributes?.entity_picture;
  if (!pic) return '';
  const path = stream ? pic.replace('/api/camera_proxy/', '/api/camera_proxy_stream/') : pic;
  return path.startsWith('/') ? (adapter.url?.(path) ?? path) : path;
}

export const cameraOpen = () => !!current;

export function closeCamera() {
  if (!current) return;
  const c = current;
  current = null;
  c.stop();
  // Empty the picture so the browser drops the live stream.
  c.img.removeAttribute('src');
  c.box.remove();
  c.onClose?.();
}

// ids: the cameras to step through; seconds: closes by itself after that long.
export function openCamera({ site, store, adapter, ids, index = 0, seconds = 120, eyebrow = t('camera.eyebrow'), title = null, onClose = null }) {
  closeCamera();
  let i = Math.max(0, Math.min(index, ids.length - 1));
  const lite = document.body.classList.contains('is-lite');
  const img = el('img', { class: 'bell-cam' });
  const heading = el('h2', { class: 'panel-title' });
  const left = el('span', { class: 'muted small' });
  let stills = null;
  const still = () => { const u = cameraUrl(store, adapter, ids[i], false); img.src = `${u}${u.includes('?') ? '&' : '?'}t=${Date.now()}`; };
  const startStills = () => { if (!stills) { stills = setInterval(still, 2000); still(); } };
  // A live picture where the camera allows it; otherwise a new still every two seconds.
  img.addEventListener('error', () => { if (current && !stills) startStills(); });
  function show() {
    clearInterval(stills); stills = null;
    const name = title ?? nameOf(ids[i], { store, site }, '');
    heading.textContent = name || t('wall.door');
    img.alt = t('wall.camera', { name });
    if (lite) startStills();
    else img.src = cameraUrl(store, adapter, ids[i], true);
    if (count) count.textContent = `${i + 1} / ${ids.length}`;
  }
  const step = (d) => { i = (i + d + ids.length) % ids.length; show(); };
  const count = ids.length > 1 ? el('span', { class: 'muted small' }) : null;
  const nav = ids.length > 1 ? el('div', { class: 'row cam-nav' },
    el('button', { class: 'chip', type: 'button', 'data-action': 'camera-prev', 'aria-label': t('camera.prev'), onclick: () => step(-1) }, '‹'),
    count,
    el('button', { class: 'chip', type: 'button', 'data-action': 'camera-next', 'aria-label': t('camera.next'), onclick: () => step(1) }, '›')) : null;
  const box = el('div', { class: 'bell', role: 'dialog', 'aria-label': eyebrow },
    el('div', { class: 'bell-card' },
      el('header', { class: 'panel-head' },
        el('div', {}, el('p', { class: 'eyebrow' }, eyebrow), heading),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('settings.close'), onclick: closeCamera }, '×')),
      img,
      el('div', { class: 'row-between' }, left, nav)));
  box.addEventListener('click', (e) => { if (e.target === box) closeCamera(); });
  const until = Date.now() + Math.max(5, seconds) * 1000;
  const tick = () => {
    const s = Math.ceil((until - Date.now()) / 1000);
    if (s <= 0) { closeCamera(); return; }
    left.textContent = t('wall.closesIn', { s });
  };
  const countdown = setInterval(tick, 1000);
  current = { box, img, onClose, stop: () => { clearInterval(countdown); clearInterval(stills); } };
  show();
  tick();
  document.body.append(box);
}

// A camera icon in a 24-unit box.
const CAMERA = 'M3 7h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM15 10.5l6-3.5v10l-6-3.5z';

// The markers for one floor plan or the overview. unit: the plan's base size.
export function cameraMarkers({ cams, unit, store, site, onOpen }) {
  const g = sv('g', { class: 'cams' });
  cams.forEach((c, i) => {
    if (!c?.entity || !Array.isArray(c.at)) return;
    const [x, y] = c.at;
    const r = unit * 1.1;
    const parts = [];
    let wedge = null;
    if (Number.isFinite(c.angle)) {
      // A 70° wedge, five icon sizes long, pointing along the angle.
      const len = unit * 6, half = (35 * Math.PI) / 180, a = (c.angle * Math.PI) / 180;
      const p = (d) => [x + Math.cos(a + d) * len, y + Math.sin(a + d) * len].map((v) => v.toFixed(1)).join(' ');
      wedge = sv('path', { class: 'cam-wedge', d: `M${x} ${y} L${p(-half)} A${len} ${len} 0 0 1 ${p(half)} Z` });
      parts.push(wedge);
    }
    const marker = sv('g', { class: 'cam', 'data-drag': 'camera', 'data-entity': c.entity, tabindex: 0, role: 'button', 'aria-label': t('camera.open', { name: nameOf(c.entity, { store, site }, c.entity) }) },
      ...parts,
      sv('circle', { class: 'cam-hit', cx: x, cy: y, r: r * 1.3 }),
      sv('circle', { class: 'cam-dot', cx: x, cy: y, r }),
      sv('path', { class: 'cam-icon', d: CAMERA, transform: `translate(${x - r * 0.62} ${y - r * 0.62}) scale(${(r * 1.24) / 24})` }));
    marker.addEventListener('click', () => onOpen(i));
    marker.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(i); } });
    g.append(marker);
    store.watch([c.entity, c.motion], () => {
      const cam = store.get(c.entity);
      const motion = c.motion ? store.get(c.motion)?.state === 'on' : !!cam?.attributes?.motion_detected;
      marker.classList.toggle('is-motion', motion);
      marker.classList.toggle('is-missing', !cam);
      marker.classList.toggle('is-off', cam?.state === 'unavailable' || cam?.state === 'off');
    });
  });
  return g;
}
