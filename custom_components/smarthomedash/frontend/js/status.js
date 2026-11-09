// What the sensors in each room say: open doors and windows, locks, presence,
// alarms and batteries, and the warnings that follow from them.
//
// A room's sensors are the ones listed in its "sensors" in site.json plus, for a
// room linked to a Home Assistant area, every matching sensor in that area. So a
// window sensor added to the area in Home Assistant shows up without any setup.

import { num } from './util.js';
import { climate } from './entities.js';
import { t } from './i18n.js';

const OPENING = new Set(['door', 'window', 'opening', 'garage_door']);
const PRESENCE = new Set(['motion', 'occupancy', 'presence']);
const ALARM = new Set(['smoke', 'gas', 'carbon_monoxide', 'moisture', 'safety']);
const UNLOCKED = new Set(['unlocked', 'open', 'opening', 'unlocking', 'jammed']);
const DEAD = new Set(['unavailable']);

// opening | presence | alarm | lock | battery | null
export function kindOf(s) {
  if (!s) return null;
  const domain = s.entity_id.split('.')[0];
  const dc = s.attributes?.device_class;
  if (domain === 'lock') return 'lock';
  if (domain === 'binary_sensor') {
    if (OPENING.has(dc)) return 'opening';
    if (PRESENCE.has(dc)) return 'presence';
    if (ALARM.has(dc)) return 'alarm';
    if (dc === 'battery') return 'battery';
  }
  if (domain === 'sensor' && dc === 'battery' && s.attributes?.unit_of_measurement === '%') return 'battery';
  return null;
}

export const isOpen = (s) => s?.state === 'on';
export const isUnlocked = (s) => UNLOCKED.has(s?.state);
export const isAlarm = (s) => s?.state === 'on';
export const isDead = (s) => !s || DEAD.has(s.state);

// Low: a battery binary sensor that is on, or a level at or under the limit.
export function isLow(s, limit) {
  if (!s) return false;
  if (s.entity_id.startsWith('binary_sensor.')) return s.state === 'on';
  const v = num(s.state);
  return v != null && v <= limit;
}

// Gives every room its sensors, sorted by kind: room.status = { opening: [ids], ... }.
export function assignSensors(site, store) {
  const areas = site.areas;
  const byArea = new Map();
  if (areas?.entityArea.size) {
    for (const s of store.all()) {
      if (!kindOf(s)) continue;
      const area = areas.entityArea.get(s.entity_id);
      if (!area) continue;
      if (!byArea.has(area)) byArea.set(area, []);
      byArea.get(area).push(s.entity_id);
    }
  }
  for (const room of site.index.rooms.values()) {
    const ids = new Set([...(room.sensors ?? []), ...(room.ha_area ? byArea.get(room.ha_area) ?? [] : [])]);
    const status = { opening: [], presence: [], alarm: [], lock: [], battery: [] };
    for (const id of ids) {
      const kind = kindOf(store.get(id)) ?? guessKind(id);
      if (kind) status[kind].push(id);
    }
    room.status = status;
  }
}

// A sensor listed in site.json that has not reported yet: judge by its id.
function guessKind(id) {
  if (id.startsWith('lock.')) return 'lock';
  if (!id.startsWith('binary_sensor.')) return null;
  if (/door|window|fonster|dorr|opening/.test(id)) return 'opening';
  if (/motion|occupancy|presence|rorelse|narvaro/.test(id)) return 'presence';
  return null;
}

// Every entity the status of a room depends on.
export const statusIds = (room) => room.status ? Object.values(room.status).flat() : [];

// What a room shows now.
export function roomStatus(store, room) {
  const st = room.status ?? {};
  const get = (ids, test) => (ids ?? []).filter((id) => test(store.get(id)));
  return {
    open: get(st.opening, isOpen),
    unlocked: get(st.lock, isUnlocked),
    present: get(st.presence, isOpen).length > 0,
    alarms: get(st.alarm, isAlarm),
  };
}

const heatingOn = (store, room) => {
  const c = room.climate ? climate(store, room.climate) : null;
  return !!c && (c.action === 'heating' || ['heat', 'heat_cool', 'auto'].includes(c.mode));
};

const ALARM_TEXT = { smoke: 'warn.smoke', gas: 'warn.gas', carbon_monoxide: 'warn.co', moisture: 'warn.leak', safety: 'warn.safety' };

// The warnings to show, most serious first:
//   { level: 'alert' | 'warn' | 'info', text, room?, items?: [names] }
// Turned off with "warnings": false in site.json; "warnings": { "battery": 20 } sets
// the battery level counted as low (default 15 %).
export function warnings(site, store, name) {
  const cfg = site.warnings === false ? null : site.warnings ?? {};
  if (!cfg) return [];
  const limit = num(cfg.battery) ?? 15;
  const out = [];
  const rooms = [...site.index.rooms.values()].filter((r) => r.status);
  for (const room of rooms) {
    for (const id of room.status.alarm) {
      const s = store.get(id);
      if (isAlarm(s)) out.push({ level: 'alert', room, text: t(ALARM_TEXT[s.attributes?.device_class] ?? 'warn.safety', { room: room.name }) });
    }
  }
  for (const room of rooms) {
    if (roomStatus(store, room).open.length && heatingOn(store, room)) {
      out.push({ level: 'warn', room, text: t('warn.openHeating', { room: room.name }) });
    }
  }
  const low = [...new Set(rooms.flatMap((r) => r.status.battery))].filter((id) => isLow(store.get(id), limit));
  if (low.length) {
    out.push({ level: 'info', key: 'battery', text: t(low.length === 1 ? 'warn.battery1' : 'warn.battery', { n: low.length }), items: low.map((id) => batteryLine(store.get(id), name)) });
  }
  const dead = warningIds(site).filter((id) => store.get(id) && isDead(store.get(id)));
  if (dead.length) {
    out.push({ level: 'info', key: 'dead', text: t(dead.length === 1 ? 'warn.dead1' : 'warn.dead', { n: dead.length }), items: dead.map(name) });
  }
  return out;
}

function batteryLine(s, name) {
  const v = num(s.state);
  return v == null ? name(s.entity_id) : `${name(s.entity_id)} · ${Math.round(v)} %`;
}

// Every entity the warnings depend on, to know when to recompute them.
export function warningIds(site) {
  const rooms = [...site.index.rooms.values()];
  return [...new Set([...site.index.lights, ...site.index.climates, ...site.index.temps, ...rooms.flatMap(statusIds)])];
}
