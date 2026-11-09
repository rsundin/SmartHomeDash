// Energy flow on the overview picture: dots running from the solar panels, the grid
// and the battery to the house, and from the house to the grid, the battery and the
// car charger, faster with more power.
//
// Points on the picture come from overview.energy_points { house, grid, battery,
// charger }, each [x, y] in image pixels, placed in the setup guide. Without them the
// house is the middle of the building under the solar panels (or the first building)
// and the grid comes in from the bottom edge below it; battery and charger need a
// point to be drawn.
//
// Signs, as most inverters report them: grid_power above zero is bought from the grid,
// battery_power above zero is the battery discharging into the house. "grid_invert" or
// "battery_invert": true under energy flips them.

import { sv, centroid, inside, clamp } from '../util.js';
import { kw } from '../entities.js';

const MIN_KW = 0.05;

export function createFlow({ site, store, ov, size: [W, H] }) {
  const E = site.energy ?? {};
  const P = ov.energy_points ?? {};
  const g = sv('g', { class: 'ov-flow', 'aria-hidden': 'true' });
  if (ov.energy_flow === false) return g;

  const panels = ov.solar?.panels ?? [];
  const solarAt = panels.length ? centroid(panels.reduce((a, b) => (a.length >= b.length ? a : b))) : null;
  const home = ov.buildings.find((b) => solarAt && inside(solarAt, b.area)) ?? ov.buildings[0];
  const house = P.house ?? (home ? centroid(home.area) : [W / 2, H / 2]);
  const grid = P.grid ?? [house[0], H - H * 0.02];

  const flows = [
    { kind: 'solar', id: ov.solar?.entity ?? E.pv_power, at: solarAt, power: (v) => v },
    { kind: 'grid', id: E.grid_power, at: grid, power: (v) => (E.grid_invert ? -v : v) },
    { kind: 'battery', id: E.battery_power, at: P.battery, power: (v) => (E.battery_invert ? -v : v) },
    { kind: 'charger', id: E.charger_power, at: P.charger, power: (v) => -Math.abs(v) },
  ].filter((f) => f.id && f.at);

  for (const f of flows) {
    // A gentle bow, so lines from different directions do not overlap at the house.
    const [x1, y1] = f.at, [x2, y2] = house;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const bow = len * 0.18;
    const cx = mx - ((y2 - y1) / len) * bow, cy = my + ((x2 - x1) / len) * bow;
    const into = `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`;   // towards the house
    const out = `M${x2} ${y2} Q${cx} ${cy} ${x1} ${y1}`;    // away from the house
    const track = sv('path', { class: 'ov-flow-track', d: into });
    const dots = sv('path', { class: `ov-flow-dots is-${f.kind}`, d: into });
    const end = sv('circle', { class: `ov-flow-end is-${f.kind}`, cx: x1, cy: y1, r: 7 });
    const grp = sv('g', { class: 'ov-flow-line' }, track, dots, end);
    g.append(grp);
    store.watch([f.id], () => {
      const v = kw(store, f.id);
      const p = v == null ? 0 : f.power(v);
      const on = Math.abs(p) >= MIN_KW;
      grp.classList.toggle('is-on', on);
      if (!on) return;
      dots.setAttribute('d', p > 0 ? into : out);
      // 3 s per loop at a trickle, down to 0.6 s at 6 kW and more
      dots.style.animationDuration = `${clamp(3 / (1 + Math.abs(p)), 0.45, 3).toFixed(2)}s`;
    });
  }
  return g;
}
