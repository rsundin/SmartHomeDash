// Power balance shared by the energy flow on the picture and the energy card: what the
// solar panels, the battery and the grid give, and where each kilowatt goes.
//
// Signs, as most inverters report them: grid_power above zero is bought from the grid,
// battery_power above zero is the battery discharging. "grid_invert" or
// "battery_invert": true under energy flips them. The car charger counts as a load.

import { t } from './i18n.js';
import { fmt } from './util.js';
import { kw } from './entities.js';

export const MIN_KW = 0.05;

export const powerIds = (E) => [E.pv_power, E.grid_power, E.battery_power, E.charger_power, E.load_power, E.battery_soc].filter(Boolean);

// Current readings in kW, or null for a sensor that is missing or unavailable.
// house is what the house itself uses: from the balance when the grid is known
// (so the split always adds up), otherwise load_power.
export function readPower(store, E, pvId = E.pv_power) {
  const val = (id) => (id ? kw(store, id) : null);
  const pv = val(pvId), g = val(E.grid_power), b = val(E.battery_power), c = val(E.charger_power);
  const solar = pv == null ? null : Math.max(0, pv);
  const grid = g == null ? null : E.grid_invert ? -g : g;
  const battery = b == null ? null : E.battery_invert ? -b : b;
  const car = c == null ? null : Math.abs(c);
  const house = grid != null
    ? Math.max(0, (solar ?? 0) + grid + (battery ?? 0) - (car ?? 0))
    : val(E.load_power);
  return { solar, grid, battery, car, house };
}

// Source -> sink pairs [{ from, to, kw }]. Solar is used first, then the battery, then
// the grid; the house is served first, then the car, the battery and export.
export function splitPower(p) {
  const src = [['solar', p.solar ?? 0], ['battery', Math.max(p.battery ?? 0, 0)], ['grid', Math.max(p.grid ?? 0, 0)]]
    .map(([k, v]) => ({ k, v }));
  const snk = [['house', p.house ?? 0], ['car', p.car ?? 0], ['battery', Math.max(-(p.battery ?? 0), 0)], ['grid', Math.max(-(p.grid ?? 0), 0)]]
    .map(([k, v]) => ({ k, v }));
  const out = [];
  for (const a of src) for (const b of snk) {
    if (a.k === b.k || a.v < MIN_KW || b.v < MIN_KW) continue;
    const v = Math.min(a.v, b.v);
    a.v -= v; b.v -= v;
    if (v >= MIN_KW) out.push({ from: a.k, to: b.k, kw: v });
  }
  return out;
}

export const kwText = (v, locale) => `${fmt(v, 1, locale)} kW`;

// "The sun gives 6.2 kW: 1.8 kW to the house, 2.0 kW to the battery and 2.4 kW to the grid."
export function powerSentence(pairs, locale) {
  const by = new Map();
  for (const f of pairs) by.set(f.from, [...(by.get(f.from) ?? []), f]);
  return [...by].map(([from, fs]) => {
    const parts = fs.map((f) => t(`flow.to.${f.to}`, { kw: kwText(f.kw, locale) }));
    const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + t('flow.and') + parts.at(-1) : parts[0];
    const total = fs.reduce((a, f) => a + f.kw, 0);
    return fs.length > 1
      ? t('flow.many', { src: t(`flow.from.${from}`), total: kwText(total, locale), parts: list })
      : t('flow.one', { src: t(`flow.from.${from}`), part: list });
  }).join(' ');
}
