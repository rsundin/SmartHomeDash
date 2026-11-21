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

// Current readings in kW, or null for a sensor that is missing, not responding or in a
// unit that is not power. house is what the house itself uses: from the balance when
// every sensor in it has a reading (so the split always adds up), otherwise load_power.
// `silent` lists the parts that are set up but have no reading: 'solar', 'grid',
// 'battery', 'car'.
//
// Solar is never below zero (many inverters read a few watts negative at night).
export function readPower(store, E, pvId = E.pv_power) {
  const val = (id) => (id ? kw(store, id) : null);
  const pv = val(pvId), g = val(E.grid_power), b = val(E.battery_power), c = val(E.charger_power);
  const solar = pv == null ? null : Math.max(0, pv);
  const grid = g == null ? null : E.grid_invert ? -g : g;
  const battery = b == null ? null : E.battery_invert ? -b : b;
  const car = c == null ? null : Math.abs(c);
  const silent = [['solar', pvId, pv], ['grid', E.grid_power, g], ['battery', E.battery_power, b], ['car', E.charger_power, c]]
    .filter(([, id, v]) => id && v == null).map(([k]) => k);
  const house = grid != null && !silent.length
    ? Math.max(0, (solar ?? 0) + grid + (battery ?? 0) - (car ?? 0))
    : val(E.load_power);
  return { solar, grid, battery, car, house, silent };
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
// Parts without a reading are named at the end ("No reading from the grid."), so the
// sentence never passes a guess off as the whole picture.
export function powerSentence(pairs, locale, silent = []) {
  const by = new Map();
  for (const f of pairs) by.set(f.from, [...(by.get(f.from) ?? []), f]);
  const said = [...by].map(([from, fs]) => {
    const parts = fs.map((f) => t(`flow.to.${f.to}`, { kw: kwText(f.kw, locale) }));
    const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + t('flow.and') + parts.at(-1) : parts[0];
    const total = fs.reduce((a, f) => a + f.kw, 0);
    return fs.length > 1
      ? t('flow.many', { src: t(`flow.from.${from}`), total: kwText(total, locale), parts: list })
      : t('flow.one', { src: t(`flow.from.${from}`), part: list });
  });
  if (silent.length) said.push(t('flow.noReading', { what: silent.map((k) => t(`flow.part.${k}`)).join(', ') }));
  return said.join(' ');
}
