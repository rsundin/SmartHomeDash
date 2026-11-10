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

// ---------- electricity prices
//
// Prices are kept at the resolution the integration gives: 24 hours, 96 quarter-hours
// (92 or 100 on the days the clocks change), or lists with start and end times. Each
// is a slot { start, end, value } in milliseconds, placed by time rather than by index.

const HOUR = 3600e3;

// [midnight, next midnight] in local time, `offset` days from `now`; 23 or 25 hours
// long on the days the clocks change.
export function dayBounds(now = new Date(), offset = 0) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const e = new Date(d);
  e.setDate(e.getDate() + 1);
  return [d.getTime(), e.getTime()];
}

const slotValue = (x) => num(typeof x === 'object' && x ? x.value ?? x.price ?? x.total : x);
const slotStart = (x) => (typeof x === 'object' && x ? Date.parse(x.start ?? x.startsAt ?? x.hour ?? x.time ?? '') : NaN);

// A price list from an attribute or an action, as slots within the day [d0, d1).
// Plain numbers divide the day evenly; entries with a start (and end) go where they say.
export function toSlots(raw, [d0, d1]) {
  if (!Array.isArray(raw) || !raw.length) return [];
  if (raw.every((x) => typeof x !== 'object' || x == null || Number.isNaN(slotStart(x)))) {
    const len = (d1 - d0) / raw.length;
    return raw.map((x, i) => ({ start: d0 + i * len, end: d0 + (i + 1) * len, value: slotValue(x) }));
  }
  const timed = raw.map((x) => ({ start: slotStart(x), end: Date.parse(x?.end ?? x?.endsAt ?? ''), value: slotValue(x) }))
    .filter((x) => !Number.isNaN(x.start) && x.start >= d0 && x.start < d1)
    .sort((a, b) => a.start - b.start);
  // Without an end, a slot lasts until the next one, or as long as the one before it.
  timed.forEach((x, i) => {
    if (Number.isNaN(x.end)) x.end = timed[i + 1]?.start ?? x.start + (i ? x.start - timed[i - 1].start : HOUR);
  });
  return timed;
}

function attributeSlots(store, cfg, attr, fallbacks, bounds) {
  const a = store.get(cfg?.entity)?.attributes;
  if (!a) return [];
  const raw = a[attr] ?? fallbacks.map((f) => a[f]).find((v) => Array.isArray(v) && v.length) ?? [];
  return toSlots(raw, bounds);
}

// Today's price slots. `fetched` holds slots from the Nord Pool action by day (see
// cards.js), used when the entity has no price attributes.
export function priceSlots(store, cfg, now = new Date(), fetched = null) {
  const bounds = dayBounds(now);
  const own = attributeSlots(store, cfg, cfg?.today_attribute || 'today', ['raw_today', 'prices_today'], bounds);
  return own.length ? own : (fetched?.get(bounds[0]) ?? []);
}

// Tomorrow's, once published (Nord Pool: early afternoon); [] before that.
export function priceSlotsTomorrow(store, cfg, now = new Date(), fetched = null) {
  const bounds = dayBounds(now, 1);
  const own = attributeSlots(store, cfg, cfg?.tomorrow_attribute || 'tomorrow', ['raw_tomorrow', 'prices_tomorrow'], bounds);
  const slots = own.length ? own : (fetched?.get(bounds[0]) ?? []);
  return slots.some((x) => x.value != null) ? slots : [];
}

// The slot running at `now`, or null.
export const slotAt = (slots, now = Date.now()) => slots.find((x) => x.start <= now && now < x.end) ?? null;

// The cheapest run of `hours` from the slot running now, over today and tomorrow:
// { start, end, avg } (ms; avg weighted by slot length), or null. Counted in slots,
// so quarter-hour prices find quarter-hour windows; a gap or a missing price breaks a run.
export function cheapestWindow(slots, now = Date.now(), hours = 3) {
  const want = hours * HOUR;
  const list = slots.filter((x) => x.end > now);
  let best = null;
  for (let i = 0; i < list.length; i++) {
    let sum = 0, len = 0;
    for (let j = i; j < list.length && len < want - 1; j++) {
      const x = list[j];
      if (x.value == null || (j > i && x.start !== list[j - 1].end)) { len = -1; break; }
      sum += x.value * (x.end - x.start);
      len += x.end - x.start;
    }
    if (len < want - 1) continue;
    const avg = sum / len;
    if (!best || avg < best.avg - 1e-9) best = { start: list[i].start, end: list[i].start + len, avg };
  }
  return best;
}

// The response of Home Assistant's Nord Pool action (nordpool.get_prices_for_date):
// { "SE3": [{ start, end, price }] } in currency per MWh, as slots per kWh.
export function nordpoolSlots(response, area = null, divisor = 1000) {
  const byArea = response?.response ?? response ?? {};
  const list = (area && byArea[area]) || Object.values(byArea).find(Array.isArray) || [];
  return list.map((x) => ({ start: Date.parse(x.start), end: Date.parse(x.end), value: num(x.price) == null ? null : num(x.price) / divisor }))
    .filter((x) => !Number.isNaN(x.start) && !Number.isNaN(x.end))
    .sort((a, b) => a.start - b.start);
}
