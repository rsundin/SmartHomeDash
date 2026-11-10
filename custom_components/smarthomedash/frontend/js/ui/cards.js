// Side column: outside, energy now, price today, lights and heat per room.
// Every card is skipped when the site config has no entity for it.

import { el, sv, fmt, hhmm, num } from '../util.js';
import { isOn, zoneLevel, kw, pricesToday, pricesTomorrow, cheapestWindow, roomTemp, climate, heating, comfort } from '../entities.js';
import { areaOf, areaName } from '../areas.js';
import { t } from '../i18n.js';
import { readPower, splitPower, powerSentence } from '../power.js';


export function createSide({ site, store, adapter, openRoom }) {
  const cards = [weatherCard, energyCard, priceCard, lightsCard, heatCard]
    .map((f) => f({ site, store, adapter, openRoom }))
    .filter(Boolean);
  return el('div', { class: 'side' }, cards);
}

const card = (label, ...kids) => el('section', { class: 'card' }, el('h2', { class: 'eyebrow' }, label), ...kids);

function weatherCard({ site, store }) {
  if (!site.weather) return null;
  const temp = el('div', { class: 'kpi' });
  const cond = el('p', { class: 'muted' });
  const grid = el('dl', { class: 'facts' });
  store.watch([site.weather, 'sun.sun'], () => {
    const w = store.get(site.weather);
    const a = w?.attributes || {};
    temp.replaceChildren(fmt(num(a.temperature), 1, site.locale), el('span', { class: 'unit' }, a.temperature_unit || '°C'));
    cond.textContent = w?.state ? t(`weather.${w.state}`) : '–';
    const sun = store.get('sun.sun')?.attributes || {};
    const ws = a.wind_speed_unit || 'm/s';
    grid.replaceChildren(
      fact(t('cards.wind'), `${fmt(num(a.wind_speed), 0, site.locale)} ${ws}`),
      fact(t('cards.gusts'), a.wind_gust_speed != null ? `${fmt(num(a.wind_gust_speed), 0, site.locale)} ${ws}` : '–'),
      fact(t('cards.sunrise'), hhmm(sun.next_rising, site.locale)),
      fact(t('cards.sunset'), hhmm(sun.next_setting, site.locale)));
  });
  return card(t('cards.outside'), el('div', { class: 'row-between' }, temp, cond), grid);
}

const fact = (k, v) => el('div', {}, el('dt', {}, k), el('dd', {}, v));

function energyCard({ site, store }) {
  const E = site.energy;
  const rows = [
    [t('cards.load'), E.load_power], [t('cards.grid'), E.grid_power], [t('cards.solar'), E.pv_power], [t('cards.battery'), E.battery_power], [t('cards.charger'), E.charger_power],
  ].filter(([, id]) => id);
  if (!rows.length) return null;
  const says = el('p', { class: 'energy-says' });
  const list = el('ul', { class: 'meters' });
  const today = el('dl', { class: 'facts' });
  const ids = rows.map(([, id]) => id).concat(E.energy_today, E.pv_energy_today, E.cost_today, E.savings_today, E.battery_soc);
  store.watch(ids, () => {
    // Where the power comes from and goes, in one sentence. Needs at least solar or the
    // battery next to the grid to say more than the rows below.
    says.textContent = E.grid_power && (E.pv_power || E.battery_power) ? powerSentence(splitPower(readPower(store, E)), site.locale) : '';
    says.hidden = !says.textContent;
    list.replaceChildren(...rows.map(([name, id]) => {
      const v = kw(store, id);
      const soc = id === E.battery_power ? num(store.get(E.battery_soc)?.state) : null;
      return el('li', { class: Math.abs(v ?? 0) > 0.01 ? 'is-active' : '' },
        el('span', { class: 'dot', 'aria-hidden': 'true' }),
        el('span', {}, name, soc != null ? el('span', { class: 'muted' }, ` · ${fmt(soc, 0, site.locale)} %`) : ''),
        el('span', { class: 'mono' }, `${fmt(v, 2, site.locale)} kW`));
    }));
    const facts = [];
    if (E.energy_today) facts.push(fact(t('cards.usedToday'), `${fmt(num(store.get(E.energy_today)?.state), 1, site.locale)} kWh`));
    if (E.pv_energy_today) facts.push(fact(t('cards.solarToday'), `${fmt(num(store.get(E.pv_energy_today)?.state), 1, site.locale)} kWh`));
    if (E.savings_today) facts.push(fact(t('cards.savingsToday'), `${fmt(num(store.get(E.savings_today)?.state), 2, site.locale)} ${site.currency}`));
    if (E.cost_today) facts.push(fact(t('cards.costToday'), `${fmt(num(store.get(E.cost_today)?.state), 2, site.locale)} ${site.currency}`));
    today.replaceChildren(...facts);
  });
  return card(t('cards.energyNow'), says, list, today);
}

function priceCard({ site, store }) {
  const cfg = site.energy.price;
  if (!cfg?.entity) return null;
  const now = el('div', { class: 'kpi' });
  const range = el('p', { class: 'muted small' });
  const chart = el('div', { class: 'price-chart' });
  const level = el('span', { class: 'price-level' });
  const best = el('p', { class: 'price-best' });
  const hours = Math.max(1, Math.min(8, num(cfg.window_hours) ?? 3));
  const hh = (h) => `${String(h % 24).padStart(2, '0')}`;
  const render = () => {
    const vals = pricesToday(store, cfg);
    const h = new Date().getHours();
    const cur = vals[h] ?? num(store.get(cfg.entity)?.state);
    now.replaceChildren(fmt(cur, 2, site.locale), el('span', { class: 'unit' }, `${site.currency}/kWh`), level);
    const ok = vals.filter((v) => v != null);
    if (!ok.length) { range.textContent = t('cards.noPrices'); chart.replaceChildren(); best.textContent = ''; level.textContent = ''; return; }
    const lo = Math.min(...ok), hi = Math.max(...ok);
    const loH = vals.indexOf(lo), hiH = vals.indexOf(hi);
    range.textContent = t('cards.priceRange', { lo: fmt(lo, 2, site.locale), loH: `${String(loH).padStart(2, '0')}:00`, hi: fmt(hi, 2, site.locale), hiH: `${String(hiH).padStart(2, '0')}:00` });
    // Cheap or dear right now, compared with the rest of the day.
    const avg = ok.reduce((a, b) => a + b, 0) / ok.length;
    const rel = cur == null ? null : (cur - avg) / (avg || 1);
    level.textContent = rel == null ? '' : rel < -0.15 ? t('cards.priceCheap') : rel > 0.15 ? t('cards.priceDear') : '';
    level.dataset.level = rel == null ? '' : rel < -0.15 ? 'cheap' : rel > 0.15 ? 'dear' : '';
    // The cheapest few hours from now, today or tomorrow: when to run the dishwasher or charge the car.
    const win = cheapestWindow(vals, pricesTomorrow(store, cfg), h, hours);
    best.textContent = win
      ? t(win.start >= 24 ? 'cards.priceBestTomorrow' : win.start === h ? 'cards.priceBestNow' : 'cards.priceBest',
        { from: hh(win.start), to: hh(win.start + hours), avg: fmt(win.avg, 2, site.locale), n: hours })
      : '';
    chart.replaceChildren(priceBars(vals, h, lo, hi, win && win.start < 24 ? [win.start, Math.min(24, win.start + hours)] : null));
  };
  store.watch([cfg.entity], render);
  // The hour changes without the price entity changing: redraw on the hour.
  const timer = setInterval(() => {
    if (!now.isConnected) { clearInterval(timer); return; } // the dashboard was rebuilt
    if (new Date().getMinutes() === 0) render();
  }, 60000);
  return card(t('cards.priceToday'), now, best, chart, range);
}

function priceBars(vals, nowH, lo, hi, window = null) {
  const W = 288, H = 74, B = 16, gap = 2;
  const bw = (W - gap * 23) / 24;
  const Y = (v) => (H - B) * (1 - v / (hi * 1.05));
  return sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pbars', role: 'img', 'aria-label': t('cards.priceChart') },
    vals.map((v, h) => {
      if (v == null) return null;
      const rel = hi === lo ? 0.5 : (v - lo) / (hi - lo);
      const cls = h === nowH ? 'now' : rel < 0.33 ? 'cheap' : rel > 0.66 ? 'dear' : 'mid';
      const y = Y(v);
      const inBest = window && h >= window[0] && h < window[1];
      return sv('rect', { x: h * (bw + gap), y, width: bw, height: H - B - y, rx: 1.5, class: `${cls}${inBest ? ' best' : ''}` },
        sv('title', {}, `${String(h).padStart(2, '0')}:00 · ${v.toFixed(2)}`));
    }),
    [0, 6, 12, 18].map((h) => sv('text', { x: h * (bw + gap), y: H - 3, class: 'axis' }, String(h).padStart(2, '0'))),
    sv('text', { x: W, y: H - 3, 'text-anchor': 'end', class: 'axis' }, '24'));
}

function lightsCard({ site, store, adapter }) {
  const zones = site.overview?.zones ?? [];
  const roomsWithLights = [...site.index.rooms.values()].filter((r) => r.lights.length);
  // Outdoor lamps in the same Home Assistant area share one switch, named after the area.
  const outdoor = [];
  for (const z of zones) {
    const area = site.areas && z.lights.map((id) => areaOf(site.areas, id)).find(Boolean);
    const group = area && outdoor.find((g) => g.area === area);
    if (group) group.lights.push(...z.lights.filter((id) => !group.lights.includes(id)));
    else outdoor.push({ area, name: (area && areaName(site.areas, area)) || z.name, lights: [...z.lights], kind: t('cards.outdoor') });
  }
  const groups = [
    ...outdoor,
    ...roomsWithLights.map((r) => ({ name: r.name, lights: r.lights.map((l) => l.entity), kind: t('cards.indoor') })),
  ];
  if (!groups.length && !site.scenes.length) return null;

  const list = el('ul', { class: 'toggles' });
  for (const g of groups) {
    const sw = el('button', { class: 'switch', type: 'button', role: 'switch', 'aria-label': g.name,
      onclick: () => adapter.call('homeassistant', zoneLevel(store, g.lights) > 0 ? 'turn_off' : 'turn_on', { entity_id: g.lights }) });
    const li = el('li', {}, el('span', {}, g.name), el('span', { class: 'tag' }, g.kind), sw);
    list.append(li);
    store.watch(g.lights, () => {
      const on = g.lights.some((id) => isOn(store.get(id)));
      sw.setAttribute('aria-checked', String(on));
      li.classList.toggle('is-on', on);
    });
  }

  const scenes = el('div', { class: 'scenes' },
    site.scenes.map((s) => el('button', { class: 'chip', type: 'button', onclick: () => adapter.call(s.entity.split('.')[0], 'turn_on', { entity_id: s.entity }) }, s.name)));

  // "All off" asks for a second tap instead of a dialog.
  let armed = null;
  const allOff = el('button', { class: 'chip chip-danger', type: 'button' }, t('cards.allOff'));
  allOff.addEventListener('click', () => {
    if (!armed) {
      allOff.textContent = t('cards.allOffConfirm');
      allOff.classList.add('is-armed');
      armed = setTimeout(() => { armed = null; allOff.textContent = t('cards.allOff'); allOff.classList.remove('is-armed'); }, 3500);
      return;
    }
    clearTimeout(armed); armed = null;
    allOff.textContent = t('cards.allOff'); allOff.classList.remove('is-armed');
    adapter.call('homeassistant', 'turn_off', { entity_id: site.index.lights });
  });
  scenes.append(allOff);

  return card(t('cards.lights'), list, scenes);
}

function heatCard({ site, store, openRoom }) {
  const rooms = site.index.climateRooms;
  if (!rooms.length) return null;
  const list = el('ul', { class: 'heat' });
  const summary = el('p', { class: 'muted small' });
  const ids = rooms.flatMap((r) => [r.climate, r.temperature]);
  const items = rooms.map((r) => {
    const val = el('span', { class: 'mono' });
    const li = el('li', {}, el('button', { type: 'button', class: 'heat-btn', onclick: () => openRoom(r) },
      el('span', { class: 'flame', 'aria-hidden': 'true' }), el('span', { class: 'heat-name', 'data-heating': t('cards.heatingSuffix') }, r.name), val));
    list.append(li);
    return { r, val, li };
  });
  store.watch(ids, () => {
    let warming = 0;
    for (const { r, val, li } of items) {
      const v = roomTemp(store, r);
      const c = r.climate ? climate(store, r.climate) : null;
      const text = `${fmt(v, 1, site.locale)}°${c?.target != null && c.mode !== 'off' ? ` / ${fmt(c.target, 1, site.locale)}°` : ''}`;
      if (val.textContent !== text) val.textContent = text;
      const h = heating(store, r);
      if (h) warming++;
      li.classList.toggle('is-heating', h);
      li.dataset.comfort = comfort(store, r, site) ?? 'none';
    }
    summary.textContent = warming ? t('cards.warming', { n: warming, total: rooms.length }) : t('cards.noneWarming');
  });
  return card(t('cards.heatByRoom'), list, summary);
}
