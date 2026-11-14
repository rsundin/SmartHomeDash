// Floor plan: rooms drawn to scale from the site config (millimetres by default),
// tinted by temperature, with a lamp for every light and a chip per room.

import { el, sv, pts, centroid, bbox, press, fmt } from '../util.js';
import { level, roomTemp, comfort, heating, climate } from '../entities.js';
import { t } from '../i18n.js';
import { lightColor, createTints } from '../glow.js';
import { roomStatus, statusIds } from '../status.js';
import { cameraMarkers, openCamera } from '../ui/camera.js';

// Status icons, drawn in a 24-unit box.
export const ICONS = {
  window: 'M5 4h14v16H5zM12 4v16M5 12h14',
  door: 'M7 3h10v18H7zM14 12.5v.01',
  unlocked: 'M6 11h12v9H6zM9 11V7.5a3 3 0 0 1 5.8-1.1',
  alarm: 'M12 3.5 21.5 20h-19zM12 10v4.5M12 17v.01',
};

const FLAME = 'M12 2c1 3.5-1.5 5-1.5 7.5A2.5 2.5 0 0 0 13 12c0-1 .5-2 1.5-2.5C16 12 18 13.5 18 16a6 6 0 0 1-12 0c0-4 3-6 6-14z';

export function createFloorplan({ site, plan, store, adapter, onRoom }) {
  const rooms = plan.rooms ?? [];
  const outline = plan.outline ?? rooms.flatMap((r) => r.area);
  const bb = bbox([outline, ...rooms.map((r) => r.area)]);
  const pad = Math.max(bb.w, bb.h) * 0.06;
  const unit = Math.max(bb.w, bb.h) / 42; // base type size in plan units
  const wall = plan.wall ?? unit * 0.38;

  const gradId = `lamp-${plan.id}`;
  // Optional realistic top-down picture of the plan, placed under the rooms.
  // bounds = [x, y, width, height] in plan units; defaults to the outline's box.
  const picture = plan.image ? (typeof plan.image === 'string' ? { src: plan.image } : plan.image) : null;
  const ob = bbox([outline]);
  const [ix, iy, iw, ih] = picture?.bounds ?? [ob.x, ob.y, ob.w, ob.h];
  // A plan from the quick start has no picture and no walls: a tile per room.
  const tiles = plan.layout === 'tiles' && !picture;
  const floor = sv('g', { class: 'fp-floor' },
    tiles ? rooms.map((r) => sv('polygon', { class: 'fp-tile', points: pts(r.area), 'stroke-width': wall * 0.5 }))
      : sv('polygon', { class: 'fp-outline', points: pts(outline) }),
    picture ? sv('image', { href: site.asset(picture.src), x: ix, y: iy, width: iw, height: ih, preserveAspectRatio: 'none', class: 'fp-picture' }) : null);
  const fills = sv('g', { class: 'fp-fills' });
  const glows = sv('g', { class: 'fp-glows' });
  const haloGradient = (id, glow, coreC) => sv('radialGradient', { id },
    sv('stop', { offset: '0', style: { stopColor: coreC, stopOpacity: '0.85' } }),
    sv('stop', { offset: '0.3', style: { stopColor: glow, stopOpacity: '0.45' } }),
    sv('stop', { offset: '1', style: { stopColor: glow, stopOpacity: '0' } }));
  const defs = sv('defs', {}, haloGradient(gradId, 'var(--glow)', 'var(--glow-core)'));
  // A lamp that reports its colour glows in it (see glow.js).
  const tint = createTints((sx, glow, coreC) => defs.append(haloGradient(gradId + sx, glow, coreC)));
  const walls = tiles ? sv('g', { class: 'fp-walls' }) : sv('g', { class: 'fp-walls' },
    rooms.map((r) => sv('polygon', { class: 'fp-inner', points: pts(r.area), 'stroke-width': wall * 0.4 })),
    sv('polygon', { class: 'fp-outer', points: pts(outline), 'stroke-width': wall }));
  const labels = sv('g', { class: 'fp-labels' });
  const lamps = sv('g', { class: 'fp-lamps' });

  for (const room of rooms) {
    const [cx, cy] = room.label ?? centroid(room.area);
    const fill = sv('polygon', { class: 'fp-room', points: pts(room.area), tabindex: 0, role: 'button', 'aria-label': room.name });
    fill.addEventListener('click', () => onRoom(room));
    fill.addEventListener('keydown', (e) => { if (e.key === 'Enter') onRoom(room); });
    fills.append(fill);

    // Shrink the name to fit narrow rooms (cupboards, utility rooms).
    const roomW = bbox([room.area]).w;
    const nameSize = Math.min(unit * 0.95, (roomW * 0.8) / (room.name.length * 0.82));
    const name = sv('text', { class: 'fp-name', x: cx, y: cy - unit * 0.35, 'font-size': nameSize, 'text-anchor': 'middle' }, room.name);
    const tempText = sv('text', { class: 'fp-temp', x: cx, y: cy + unit * 1.15, 'font-size': unit * 1.25, 'text-anchor': 'middle' });
    const flame = sv('path', { class: 'fp-flame', d: FLAME, transform: `translate(${cx - unit * 2.6} ${cy + unit * 0.05}) scale(${unit / 18})` });
    const g = sv('g', { class: 'fp-label' }, name, tempText, flame);
    labels.append(g);

    // Open doors and windows, unlocked locks and alarms: small icons above the name.
    // A room with motion or presence right now gets a faint outline.
    if (statusIds(room).length) {
      const badges = sv('g', { class: 'fp-badges' });
      badges.style.pointerEvents = 'none';
      labels.append(badges);
      const size = unit * 1.5;
      store.watch(statusIds(room), () => {
        const st = roomStatus(store, room);
        fill.classList.toggle('is-occupied', st.present);
        const icons = [
          ...st.alarms.map(() => ['alarm', 'is-alarm']),
          ...st.open.map((id) => [store.get(id)?.attributes?.device_class === 'window' ? 'window' : 'door', 'is-open']),
          ...st.unlocked.map(() => ['unlocked', 'is-open']),
        ].slice(0, 4);
        const x0 = cx - ((icons.length - 1) * size * 1.15) / 2;
        badges.replaceChildren(...icons.map(([icon, cls], i) => sv('g', {
          class: `fp-badge ${cls}`, transform: `translate(${x0 + i * size * 1.15 - size / 2} ${cy - unit * 2.9}) scale(${size / 24})`,
        }, sv('circle', { cx: 12, cy: 12, r: 12 }), sv('path', { d: ICONS[icon], transform: 'translate(3.6 3.6) scale(0.7)' }))));
      });
    }

    const ids = [room.climate, room.temperature];
    store.watch(ids, () => {
      const temp = roomTemp(store, room);
      const c = room.climate ? climate(store, room.climate) : null;
      const state = comfort(store, room, site);
      fill.setAttribute('data-comfort', state ?? 'none');
      const cur = temp == null ? '' : `${fmt(temp, 1, site.locale)}°`;
      const showTarget = temp != null && c?.target != null && c.mode !== 'off';
      const tgt = showTarget ? ` /${fmt(c.target, Number.isInteger(c.target) ? 0 : 1, site.locale)}` : '';
      tempText.replaceChildren(cur, tgt ? sv('tspan', { class: 'fp-target', 'font-size': unit * 0.8 }, tgt) : '');
      const heat = heating(store, room);
      const half = (cur.length * 0.6 + tgt.length * 0.4) * unit * 1.25 / 2;
      flame.setAttribute('transform', `translate(${cx - half - unit * 1.5} ${cy - unit * 0.05}) scale(${unit / 19})`);
      flame.style.display = heat ? '' : 'none';
    });

    for (const light of room.lights) {
      const [x, y] = light.at ?? [cx, cy + unit * 2.5];
      const halo = sv('circle', { class: 'fp-halo', cx: x, cy: y, r: unit * 4.5, fill: `url(#${gradId})` });
      glows.append(halo);
      const lamp = sv('g', { class: 'fp-lamp', 'data-drag': 'light', 'data-entity': light.entity, tabindex: 0, role: 'button', 'aria-label': t('overview.toggle', { name: light.name ?? room.name }) },
        sv('circle', { class: 'fp-lamp-hit', cx: x, cy: y, r: unit * 1.1 }),
        sv('circle', { class: 'fp-lamp-ring', cx: x, cy: y, r: unit * 0.55, 'stroke-width': unit * 0.14 }),
        sv('circle', { class: 'fp-lamp-core', cx: x, cy: y, r: unit * 0.3 }),
        sv('title', {}, t('plan.lampHint', { name: light.name ?? room.name })));
      press(lamp,
        () => adapter.call('homeassistant', 'toggle', { entity_id: light.entity }),
        () => onRoom(room));
      lamps.append(lamp);
      store.watch([light.entity], () => {
        const st = store.get(light.entity);
        const lv = level(st);
        const c = tint(lightColor(st));
        halo.style.opacity = String(lv);
        halo.setAttribute('fill', `url(#${gradId}${c.suffix})`);
        lamp.style.setProperty('--lamp', c.glow ?? '');
        lamp.style.setProperty('--lamp-core', c.core ?? '');
        lamp.classList.toggle('is-on', lv > 0);
        lamp.classList.toggle('is-missing', !store.get(light.entity));
      });
    }
  }

  // Cameras on the plan (ui/camera.js): a tap opens the camera window, with arrows to the plan's other cameras.
  const cams = (plan.cameras ?? []).filter((c) => c?.entity && Array.isArray(c.at));
  const camsG = cameraMarkers({ cams, unit, store, site,
    onOpen: (i) => openCamera({ site, store, adapter, ids: cams.map((c) => c.entity), index: i }) });

  const svg = sv('svg', {
    class: 'fp-svg', viewBox: `${bb.x - pad} ${bb.y - pad} ${bb.w + pad * 2} ${bb.h + pad * 2}`,
    role: 'group', 'aria-label': t('plan.label', { name: plan.name }),
  },
  defs,
  floor, fills, glows, walls, labels, lamps, camsG);

  const root = el('div', { class: `view fp${picture ? ' has-picture' : ''}${tiles ? ' is-tiles' : ''}`, 'data-plan': plan.id }, svg);

  return {
    el: root,
    svg,
    select(roomId) {
      fills.querySelectorAll('.fp-room').forEach((n, i) => n.classList.toggle('is-selected', rooms[i].id === roomId));
    },
  };
}
