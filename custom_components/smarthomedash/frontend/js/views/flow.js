// Energy flow on the overview picture: one line for each real flow, from where the power
// comes from to where it goes, in the colour of the source (sun, battery, grid). Wider
// and faster with more power, with the kilowatts on the line. Solar charging the
// battery runs straight from the roof to the battery, not through the house.
//
// Labels at the battery, the grid, the car charger and the house say what each one does
// ("Selling 2.4 kW"). The solar panels have their own kW label (overview.js).
//
// Points on the picture come from overview.energy_points { house, grid, battery,
// charger }, each [x, y] in image pixels, placed in the setup guide. Without them the
// house is the middle of the building under the solar panels (or the first building)
// and the grid comes in from the bottom edge below it; battery and charger need a
// point to be drawn. The split itself is in power.js.

import { sv, centroid, inside, clamp } from '../util.js';
import { t } from '../i18n.js';
import { MIN_KW, powerIds, readPower, splitPower, kwText } from '../power.js';

export function createFlow({ site, store, ov, size: [W, H] }) {
  const E = site.energy ?? {};
  const P = ov.energy_points ?? {};
  const g = sv('g', { class: 'ov-flow', 'aria-hidden': 'true' });
  if (ov.energy_flow === false) return g;

  const panels = ov.solar?.panels ?? [];
  const solarAt = panels.length ? centroid(panels.reduce((a, b) => (a.length >= b.length ? a : b))) : null;
  const home = ov.buildings.find((b) => solarAt && inside(solarAt, b.area)) ?? ov.buildings[0];
  const house = P.house ?? (home ? centroid(home.area) : [W / 2, H / 2]);
  const pvId = ov.solar?.entity ?? E.pv_power;

  // Only the parts this site has, at a point on the picture.
  const at = {
    house,
    solar: pvId && solarAt,
    grid: E.grid_power && (P.grid ?? [house[0], H - H * 0.02]),
    battery: E.battery_power && P.battery,
    car: E.charger_power && P.charger,
  };
  const ids = powerIds({ ...E, pv_power: pvId });
  if (!ids.length) return g;

  const lines = sv('g'), tags = sv('g');
  g.append(lines, tags);

  // One line per source -> sink pair, made once and switched on and off.
  const PAIRS = [['solar', 'house'], ['solar', 'car'], ['solar', 'battery'], ['solar', 'grid'],
    ['battery', 'house'], ['battery', 'car'], ['battery', 'grid'],
    ['grid', 'house'], ['grid', 'car'], ['grid', 'battery']];
  const pairs = new Map();
  for (const [from, to] of PAIRS) {
    if (!at[from] || !at[to]) continue;
    const { d, mid } = bow(at[from], at[to], from === 'solar' && to === 'grid' ? 0.1 : 0.18);
    const track = sv('path', { class: 'ov-flow-track', d });
    const dots = sv('path', { class: 'ov-flow-dots', d });
    const line = sv('g', { class: `ov-flow-line is-${from}` }, track, dots);
    const tag = label(mid, `is-${from}`);
    lines.append(line);
    tags.append(tag.g);
    pairs.set(`${from}>${to}`, { line, track, dots, tag });
  }

  // What each end is doing, next to its point.
  const ends = {};
  for (const k of ['battery', 'grid', 'car', 'house']) {
    if (!at[k]) continue;
    const [x, y] = at[k];
    const dot = sv('circle', { class: `ov-flow-end is-${k}`, cx: x, cy: y, r: 8 });
    const below = k === 'house' || y < 60;
    const tag = label([x, below ? y + 38 : y - 36], `is-${k}`);
    tags.append(dot, tag.g);
    ends[k] = { dot, tag };
  }

  store.watch(ids, () => {
    const p = readPower(store, E, pvId);
    const flows = new Map(splitPower(p).map((f) => [`${f.from}>${f.to}`, f.kw]));
    for (const [key, el] of pairs) {
      const v = flows.get(key) ?? 0;
      const on = v >= MIN_KW;
      el.line.classList.toggle('is-on', on);
      el.tag.g.classList.toggle('is-on', on);
      if (!on) continue;
      const w = clamp(3 + v * 2, 3, 16);
      el.track.style.strokeWidth = `${w}px`;
      el.dots.style.strokeWidth = `${w + 4}px`;
      // 3 s per loop at a trickle, down to 0.5 s at 5 kW and more
      el.dots.style.animationDuration = `${clamp(3 / (1 + v), 0.5, 3).toFixed(2)}s`;
      el.tag.set('', kwText(v, site.locale));
    }
    const soc = E.battery_soc ? store.get(E.battery_soc)?.state : null;
    const socText = soc != null && Number.isFinite(+soc) ? `${Math.round(+soc)} %` : '';
    const text = {
      battery: Math.abs(p.battery ?? 0) >= MIN_KW
        ? [t(p.battery > 0 ? 'flow.batteryOut' : 'flow.batteryIn'), kwText(Math.abs(p.battery), site.locale), socText]
        : [t('flow.battery'), socText],
      grid: Math.abs(p.grid ?? 0) >= MIN_KW ? [t(p.grid > 0 ? 'flow.buying' : 'flow.selling'), kwText(Math.abs(p.grid), site.locale)] : null,
      car: (p.car ?? 0) >= MIN_KW ? [t('flow.carCharging'), kwText(p.car, site.locale)] : null,
      house: (p.house ?? 0) >= MIN_KW ? [t('flow.house'), kwText(p.house, site.locale)] : null,
    };
    for (const [k, end] of Object.entries(ends)) {
      const v = text[k];
      const on = !!v && !!(v[1] || v[2]);
      end.dot.classList.toggle('is-on', on);
      end.tag.g.classList.toggle('is-on', on);
      if (on) end.tag.set(...v);
    }
  });

  return g;

  // A pill with a word, a value and an optional extra, centred on [x, y] and kept on the picture.
  function label([x, y], cls) {
    const rect = sv('rect', { height: 30, rx: 15, y: -15 });
    const word = sv('tspan', { class: 'ov-flow-word' });
    const value = sv('tspan', { class: 'ov-flow-kw' });
    const extra = sv('tspan', { class: 'ov-flow-extra' });
    const text = sv('text', { 'text-anchor': 'middle', y: 6 }, word, value, extra);
    const gg = sv('g', { class: `ov-flow-tag ${cls}` }, rect, text);
    const fit = (textWidth) => {
      const width = textWidth + 24;
      rect.setAttribute('x', (-width / 2).toFixed(1));
      rect.setAttribute('width', width.toFixed(1));
      const cx = clamp(x, width / 2 + 4, W - width / 2 - 4), cy = clamp(y, 19, H - 19);
      gg.setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)})`);
    };
    return {
      g: gg,
      set(w, v, x2 = '') {
        word.textContent = w ? `${w} ` : '';
        value.textContent = v;
        extra.textContent = x2 ? ` · ${x2}` : '';
        // A guess first (Barlow about 8 px a character, IBM Plex Mono 10 px), then the
        // measured width once the label is on the page.
        fit((word.textContent.length + extra.textContent.length) * 8 + v.length * 10.2);
        requestAnimationFrame(() => {
          try { const w = text.getBBox().width; if (w > 0) fit(w); } catch { /* not drawn */ }
        });
      },
    };
  }
}

// A gentle bow from a to b, so lines between the same points in other pairs do not overlap.
function bow([x1, y1], [x2, y2], k) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const b = len * k;
  const cx = (x1 + x2) / 2 - ((y2 - y1) / len) * b, cy = (y1 + y2) / 2 + ((x2 - x1) / len) * b;
  return {
    d: `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`,
    mid: [0.25 * x1 + 0.5 * cx + 0.25 * x2, 0.25 * y1 + 0.5 * cy + 0.25 * y2],
  };
}
