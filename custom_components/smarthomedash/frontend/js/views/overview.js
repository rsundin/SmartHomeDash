// Overview: the photo/render of the property with live light on it.
//
// Two stacked SVGs share the image's pixel coordinates:
//   lower: base image, a "hole" per building and a roof clone (darkened at night)
//   upper: light (never darkened): lamps, lit windows, solar glow, hit areas
//
// Light is drawn with additive (screen) blending, so it brightens what is under it
// the way real light does: a wall lamp washes the facade and pools on the ground,
// a lit room shows warm windows, producing solar panels glow green.

import { el, sv, pts, centroid, bbox, press, clamp, fmt } from '../util.js';
import { zoneLevel, kw } from '../entities.js';
import { t } from '../i18n.js';

export function createOverview({ site, store, adapter, onOpenBuilding }) {
  const ov = site.overview;
  const [W, H] = ov.size;
  const img = site.asset(ov.image);
  // Optional dusk render with every light off, same size and framing as the day image.
  // Used after sunset instead of darkening the day photo.
  const nightImg = ov.night_image ? site.asset(ov.night_image) : null;
  const vb = `0 0 ${W} ${H}`;
  const k = site.id.replace(/\W/g, '');

  // Day and night images stacked; CSS crossfades between them.
  const pictures = (clip) => [
    sv('image', { href: img, width: W, height: H, class: 'ov-img-day', 'clip-path': clip }),
    nightImg ? sv('image', { href: nightImg, width: W, height: H, class: 'ov-img-night', 'clip-path': clip }) : null,
  ];

  // ---------- lower layer
  const clips = ov.buildings.map((b) =>
    sv('clipPath', { id: `clip-${k}-${b.id}` }, sv('polygon', { points: pts(b.area) })));
  const lower = sv('svg', { viewBox: vb, class: 'ov-lower', 'aria-hidden': 'true' },
    sv('defs', {}, clips),
    pictures(null),
    ov.buildings.map((b) => sv('polygon', { class: 'ov-hole', 'data-b': b.id, points: pts(b.area) })),
    ov.buildings.map((b) => sv('g', { class: 'ov-roof', 'data-b': b.id }, pictures(`url(#clip-${k}-${b.id})`))),
    sv('rect', { class: 'ov-tint', width: W, height: H }),
  );

  // ---------- shared paint
  const stop = (offset, color, opacity) => sv('stop', { offset, style: { stopColor: color, stopOpacity: String(opacity) } });
  const defs = sv('defs', {},
    sv('radialGradient', { id: `${k}-glow` }, stop('0', 'var(--glow-core)', 1), stop('0.22', 'var(--glow)', 0.8), stop('1', 'var(--glow)', 0)),
    sv('radialGradient', { id: `${k}-wash`, cy: '0.35', r: '0.6' }, stop('0', 'var(--glow-core)', 0.9), stop('0.35', 'var(--glow)', 0.55), stop('1', 'var(--glow)', 0)),
    sv('radialGradient', { id: `${k}-pool` }, stop('0', 'var(--glow)', 0.55), stop('1', 'var(--glow)', 0)),
    sv('linearGradient', { id: `${k}-window`, x1: '0', y1: '0', x2: '0', y2: '1' }, stop('0', 'var(--glow-core)', 0.95), stop('1', 'var(--glow)', 0.85)),
    sv('linearGradient', { id: `${k}-sweep`, x1: '0', y1: '0', x2: '1', y2: '0.4', gradientUnits: 'objectBoundingBox' },
      stop('0', 'var(--solar-core)', 0), stop('0.45', 'var(--solar-core)', 0), stop('0.5', 'var(--solar-core)', 0.7), stop('0.55', 'var(--solar-core)', 0), stop('1', 'var(--solar-core)', 0),
      sv('animateTransform', { attributeName: 'gradientTransform', type: 'translate', from: '-1 0', to: '1 0', dur: '5s', repeatCount: 'indefinite' })),
    sv('filter', { id: `${k}-soft`, x: '-50%', y: '-50%', width: '200%', height: '200%' }, sv('feGaussianBlur', { stdDeviation: '2.2' })),
    sv('filter', { id: `${k}-wide`, x: '-60%', y: '-60%', width: '220%', height: '220%' }, sv('feGaussianBlur', { stdDeviation: '5' })),
    sv('filter', { id: `${k}-bloom`, x: '-80%', y: '-80%', width: '260%', height: '260%' }, sv('feGaussianBlur', { stdDeviation: '9' })),
  );

  // ---------- windows: warm when a light in the room behind them is on
  const windowsG = sv('g', { class: 'ov-windows' });
  for (const w of ov.windows ?? []) {
    const lights = windowLights(site, w);
    if (!lights.length) continue;
    const g = sv('g', { class: 'ov-window' },
      sv('polygon', { points: pts(w.area), filter: `url(#${k}-bloom)`, class: 'ov-window-bloom' }),
      sv('polygon', { points: pts(w.area), fill: `url(#${k}-window)`, filter: `url(#${k}-soft)` }));
    windowsG.append(g);
    store.watch(lights, () => { g.style.opacity = String(zoneLevel(store, lights)); });
  }

  // ---------- lamps per zone
  const lampsG = sv('g', { class: 'ov-glows' });
  for (const z of ov.zones) {
    const g = sv('g', { class: 'ov-zone', 'data-zone': z.id }, z.lamps.map((l) => lampShape(l, k)));
    lampsG.append(g);
    store.watch(z.lights, () => {
      const lv = zoneLevel(store, z.lights);
      g.style.opacity = String(lv);
      g.classList.toggle('is-on', lv > 0);
    });
  }

  // ---------- solar: green glow scaled by current production
  const solarG = sv('g', { class: 'ov-solar' });
  let chip = null; // kW label, drawn outside the additive layer so it stays readable
  const solar = ov.solar;
  const pvId = solar?.entity ?? site.energy.pv_power;
  if (solar?.panels?.length && pvId) {
    const peak = solar.peak_kw ?? 5;
    const glow = sv('g', { class: 'ov-solar-glow' },
      solar.panels.map((p) => sv('polygon', { points: pts(p), filter: `url(#${k}-bloom)` })));
    const edge = sv('g', { class: 'ov-solar-edge' }, solar.panels.map((p) => sv('polygon', { points: pts(p) })));
    const sweep = sv('g', { class: 'ov-solar-sweep' }, solar.panels.map((p) => sv('polygon', { points: pts(p), fill: `url(#${k}-sweep)` })));
    const biggest = solar.panels.reduce((a, b) => (area(b) > area(a) ? b : a));
    const [lx, ly] = solar.label ?? centroid(biggest);
    const chipText = sv('text', { x: lx, y: ly - 20, 'text-anchor': 'middle' });
    const chipBg = sv('rect', { y: ly - 44, height: 34, rx: 17 });
    chip = sv('g', { class: 'ov-solar-chip' }, chipBg, chipText);
    solarG.append(glow, sweep, edge);
    store.watch([pvId], () => {
      const p = kw(store, pvId) ?? 0;
      const lv = p > 0.02 ? clamp(0.3 + 0.7 * (p / peak), 0.3, 1) : 0;
      solarG.style.opacity = String(lv);
      solarG.classList.toggle('is-on', lv > 0);
      chip.style.opacity = lv > 0 ? '1' : '0';
      chipText.textContent = t('overview.solar', { kw: fmt(p, 1, site.locale) });
      const w = chipText.textContent.length * 11 + 30;
      chipBg.setAttribute('x', lx - w / 2);
      chipBg.setAttribute('width', w);
    });
  }

  // ---------- hit areas
  const hits = sv('g', { class: 'ov-hits' });
  for (const b of ov.buildings) {
    const [cx, cy] = centroid(b.area);
    const label = b.floorplan ? t('overview.openPlan', { name: b.name }) : b.name;
    const poly = sv('polygon', {
      class: 'ov-bld', points: pts(b.area), tabindex: b.floorplan ? 0 : null,
      role: b.floorplan ? 'button' : null, 'aria-label': label,
    });
    const tag = sv('g', { class: 'ov-tag', transform: `translate(${cx} ${cy})` },
      sv('rect', { x: -label.length * 4.3 - 14, y: -15, width: label.length * 8.6 + 28, height: 30, rx: 15 }),
      sv('text', { 'text-anchor': 'middle', y: 5 }, label));
    const grp = sv('g', { class: 'ov-bgroup' }, poly, tag);
    if (b.floorplan) {
      grp.addEventListener('click', () => onOpenBuilding(b));
      poly.addEventListener('keydown', (e) => { if (e.key === 'Enter') onOpenBuilding(b); });
    }
    hits.append(grp);
  }
  const zoneHits = sv('g', { class: 'ov-zonehits' });
  for (const z of ov.zones) {
    for (const l of z.lamps) {
      const [x, y] = l.at;
      const c = sv('circle', { class: 'ov-zonehit', cx: x, cy: y, r: Math.max(l.size * 0.5, 16), tabindex: 0, role: 'button', 'aria-label': t('overview.toggle', { name: z.name }) },
        sv('title', {}, t('overview.toggleHint', { name: z.name })));
      press(c, () => toggleZone(z));
      zoneHits.append(c);
    }
  }

  const upper = sv('svg', { viewBox: vb, class: 'ov-upper' },
    defs, windowsG, solarG, lampsG, chip, hits, zoneHits);

  const root = el('div', { class: `view ov${nightImg ? ' has-night-image' : ''}`, style: { aspectRatio: `${W} / ${H}` } }, lower, upper);

  function toggleZone(z) {
    const on = zoneLevel(store, z.lights) > 0;
    adapter.call('homeassistant', on ? 'turn_off' : 'turn_on', { entity_id: z.lights });
  }

  // ---------- framing
  // 'meet' shows the whole image. 'slice' fills the stage (wall screens) and crops
  // around everything the config places on the image, so no lamp or building falls
  // outside the frame when the screen's shape differs from the photo's.
  const placed = [
    ...ov.buildings.map((b) => b.area),
    ...ov.zones.flatMap((z) => z.lamps.map((l) => [l.at])),
    ...(ov.solar?.panels ?? []),
    ...(ov.windows ?? []).map((w) => w.area),
  ];
  const content = placed.length ? bbox(placed) : { x: 0, y: 0, w: W, h: H };
  let fit = 'meet';
  function frame() {
    let box = `0 0 ${W} ${H}`;
    let par = 'xMidYMid meet';
    const r = root.getBoundingClientRect();
    const aspect = r.width / r.height;
    const vw = aspect < W / H ? H * aspect : W;
    const vh = aspect < W / H ? H : W / aspect;
    // Crop only while everything placed on the image still fits; otherwise show it whole.
    const fits = content.w <= vw * 1.02 && content.h <= vh * 1.02;
    if (fit === 'slice' && r.width > 0 && r.height > 0 && fits) {
      const x0 = clamp(content.x + content.w / 2 - vw / 2, 0, W - vw);
      const y0 = clamp(content.y + content.h / 2 - vh / 2, 0, H - vh);
      box = `${x0.toFixed(1)} ${y0.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`;
      par = 'xMidYMid slice';
    }
    for (const s of [lower, upper]) { s.setAttribute('viewBox', box); s.setAttribute('preserveAspectRatio', par); }
  }
  if ('ResizeObserver' in window) new ResizeObserver(frame).observe(root);

  return {
    el: root,
    svg: upper,
    setNight(night) { root.classList.toggle('is-night', night); },
    setFit(mode) { fit = mode; frame(); },
    lift(buildingId) {
      root.querySelectorAll(`[data-b="${buildingId}"]`).forEach((n) => n.classList.add('is-lifted'));
      root.classList.add('is-lifting');
    },
    drop() {
      root.querySelectorAll('.is-lifted').forEach((n) => n.classList.remove('is-lifted'));
      root.classList.remove('is-lifting');
    },
  };
}

// One lamp, by type. Sizes are in image pixels.
//   wall:   fixture on a facade, washes the wall and pools on the ground below
//   ground: flood or deck light, a flat pool of light
//   point:  round glow (default)
function lampShape(l, k) {
  const [x, y] = l.at;
  const s = l.size ?? 30;
  const core = sv('circle', { cx: x, cy: y, r: Math.max(1.6, s * 0.07), class: 'ov-lamp-core' });
  if (l.type === 'wall') {
    return sv('g', { class: 'ov-lamp ov-lamp-wall' },
      sv('ellipse', { cx: x, cy: y + s * 0.5, rx: s * 1.15, ry: s * 1.7, fill: `url(#${k}-wash)`, filter: `url(#${k}-wide)` }),
      sv('ellipse', { cx: x, cy: y + s * 2.1, rx: s * 1.7, ry: s * 0.6, fill: `url(#${k}-pool)`, filter: `url(#${k}-soft)` }),
      sv('circle', { cx: x, cy: y, r: s * 0.5, fill: `url(#${k}-glow)` }),
      core);
  }
  if (l.type === 'ground') {
    return sv('g', { class: 'ov-lamp ov-lamp-ground' },
      sv('ellipse', { cx: x, cy: y, rx: s * 1.6, ry: s * 0.75, fill: `url(#${k}-pool)` }),
      sv('circle', { cx: x, cy: y, r: s * 0.45, fill: `url(#${k}-glow)` }),
      core);
  }
  return sv('g', { class: 'ov-lamp' }, sv('circle', { cx: x, cy: y, r: s * 1.4, fill: `url(#${k}-glow)` }), core);
}

// A window lights up from its room's lights, or from lights listed on the window itself.
function windowLights(site, w) {
  if (w.lights) return w.lights;
  const room = site.index.rooms.get(w.room);
  return room ? room.lights.map((l) => l.entity) : [];
}

function area(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]; const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a / 2);
}
