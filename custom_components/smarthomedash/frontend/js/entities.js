// Read helpers that turn raw HA state objects into the values the views draw.
import { num } from './util.js';

export const isOn = (s) => s?.state === 'on';

// 0..1, 0 when off or unavailable
export function level(s) {
  if (!isOn(s)) return 0;
  const b = num(s.attributes?.brightness);
  return b == null ? 1 : Math.max(0.08, b / 255);
}

export function zoneLevel(store, lights) {
  return Math.max(0, ...lights.map((id) => level(store.get(id))));
}

export function climate(store, id) {
  const s = store.get(id);
  if (!s) return null;
  const a = s.attributes || {};
  return {
    mode: s.state,
    modes: a.hvac_modes || [],
    target: num(a.temperature),
    current: num(a.current_temperature),
    action: a.hvac_action || (s.state === 'off' ? 'off' : null),
    step: num(a.target_temp_step) || 0.5,
    min: num(a.min_temp) ?? 5,
    max: num(a.max_temp) ?? 30,
    preset: a.preset_mode ?? null,
    presets: a.preset_modes || [],
  };
}

// Room temperature: a dedicated sensor wins over the thermostat's own reading.
export function roomTemp(store, room) {
  const sensor = num(store.get(room.temperature)?.state);
  if (sensor != null) return sensor;
  return room.climate ? climate(store, room.climate)?.current ?? null : null;
}

// 'cold' | 'ok' | 'warm' | null
export function comfort(store, room, site) {
  const t = roomTemp(store, room);
  if (t == null) return null;
  const c = room.climate ? climate(store, room.climate) : null;
  if (c?.target != null && c.mode !== 'off') {
    if (t < c.target - 0.5) return 'cold';
    if (t > c.target + 1.0) return 'warm';
    return 'ok';
  }
  const lo = site.comfort?.low ?? 19, hi = site.comfort?.high ?? 23;
  return t < lo ? 'cold' : t > hi ? 'warm' : 'ok';
}

export const heating = (store, room) =>
  room.climate ? climate(store, room.climate)?.action === 'heating' : false;

// Power in kW from a sensor that may report W or kW.
export function kw(store, id) {
  const s = store.get(id);
  const v = num(s?.state);
  if (v == null) return null;
  const unit = (s.attributes?.unit_of_measurement || 'W').toLowerCase();
  return unit === 'kw' ? v : v / 1000;
}

// Hourly prices for today from common price integrations.
export function pricesToday(store, cfg) {
  const s = store.get(cfg?.entity);
  if (!s) return [];
  const a = s.attributes || {};
  const raw = a[cfg.today_attribute || 'today'] ?? a.raw_today ?? a.prices_today ?? [];
  const vals = raw.map((x) => num(typeof x === 'object' ? x.value ?? x.price ?? x.total : x));
  if (vals.length > 24) {
    // quarter-hour prices: average per hour
    const out = [];
    const per = Math.round(vals.length / 24);
    for (let h = 0; h < 24; h++) {
      const slice = vals.slice(h * per, h * per + per).filter((v) => v != null);
      out.push(slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null);
    }
    return out;
  }
  return vals;
}
