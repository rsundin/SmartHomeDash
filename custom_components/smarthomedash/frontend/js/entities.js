// Read helpers that turn raw HA state objects into the values the views draw.
import { num } from './util.js';

export const isOn = (s) => s?.state === 'on';

// The name to show for an entity, the way Home Assistant shows it (2026.11 naming:
// device name plus entity name, with friendly_name on its way out). In this order:
//   1. a name set for it in site.json (site.index.labels)
//   2. the entity registry: its own name, combined with its device's name the way
//      Home Assistant does, or the device's name alone when the entity has none
//   3. the state's friendly_name
//   4. `fallback`, which defaults to the entity id
// ctx: { store, site, areas }. `areas` (from areas.js resolve) holds the registries
// and defaults to site.areas.
export function nameOf(id, { store, site, areas = site?.areas } = {}, fallback = id) {
  if (!id) return fallback;
  return site?.index?.labels?.get(id)
    ?? registryName(areas, id)
    ?? store?.get(id)?.attributes?.friendly_name
    ?? fallback;
}

// Device name + entity name from the registries, or null when they say nothing.
// Works with both shapes Home Assistant hands out: the panel's hass.entities (name is
// already the user's or the integration's name) and the websocket entity registry
// (name is the user's override, original_name the integration's).
export function registryName(areas, id) {
  const e = areas?.entityReg?.get(id);
  if (!e) return null;
  const own = e.name || e.original_name || null;
  const d = e.device_id ? areas.deviceReg?.get(e.device_id) : null;
  const device = d ? d.name_by_user || d.name || null : null;
  if (!device) return own;
  if (!own) return e.has_entity_name === false ? null : device;
  // Older integrations name the entity in full ("Kitchen ceiling light"); so does a
  // name that already starts with the device's.
  if (e.has_entity_name === false || own.toLowerCase().startsWith(device.toLowerCase())) return own;
  return `${device} ${own}`;
}

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
  return hourly(store, cfg, cfg?.today_attribute || 'today', ['raw_today', 'prices_today']);
}

// Tomorrow's hourly prices, once published (Nord Pool: early afternoon). [] before that.
export function pricesTomorrow(store, cfg) {
  const vals = hourly(store, cfg, cfg?.tomorrow_attribute || 'tomorrow', ['raw_tomorrow', 'prices_tomorrow']);
  return vals.some((v) => v != null) ? vals : [];
}

// The cheapest run of `hours` whole hours from now on, over today and tomorrow:
// { start: hour index from today's midnight, avg } or null.
export function cheapestWindow(today, tomorrow, fromHour, hours = 3) {
  const all = [...today, ...tomorrow];
  let best = null;
  for (let h = fromHour; h + hours <= all.length; h++) {
    const slice = all.slice(h, h + hours);
    if (slice.some((v) => v == null)) continue;
    const avg = slice.reduce((a, b) => a + b, 0) / hours;
    if (!best || avg < best.avg) best = { start: h, avg };
  }
  return best;
}

function hourly(store, cfg, attr, fallbacks) {
  const s = store.get(cfg?.entity);
  if (!s) return [];
  const a = s.attributes || {};
  const raw = a[attr] ?? fallbacks.map((f) => a[f]).find(Boolean) ?? [];
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
