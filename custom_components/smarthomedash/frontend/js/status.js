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
// Covers that are a way in (shown like doors) rather than something over a window.
const COVER_OPENING = new Set(['garage', 'gate', 'door']);

// opening | presence | alarm | lock | battery | cover | null
export function kindOf(s) {
  if (!s) return null;
  const domain = s.entity_id.split('.')[0];
  const dc = s.attributes?.device_class;
  if (domain === 'lock') return 'lock';
  if (domain === 'cover') return COVER_OPENING.has(dc) ? 'opening' : 'cover';
  if (domain === 'binary_sensor') {
    if (OPENING.has(dc)) return 'opening';
    if (PRESENCE.has(dc)) return 'presence';
    if (ALARM.has(dc)) return 'alarm';
    if (dc === 'battery') return 'battery';
  }
  if (domain === 'sensor' && dc === 'battery' && s.attributes?.unit_of_measurement === '%') return 'battery';
  return null;
}

export const isOpen = (s) => s?.state === 'on' || s?.state === 'open' || s?.state === 'opening';
// Blinds and curtains: closed when fully down, or under 10 % open.
export function isClosedCover(s) {
  if (!s) return false;
  const pos = num(s.attributes?.current_position);
  return pos != null ? pos < 10 : s.state === 'closed';
}
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
    const status = { opening: [], presence: [], alarm: [], lock: [], battery: [], cover: [] };
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
  if (id.startsWith('cover.')) return /garage|gate|port|grind/.test(id) ? 'opening' : 'cover';
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
  const missing = missingEntities(site, store);
  if (missing.length) {
    out.push({ level: 'info', key: 'missing', text: t(missing.length === 1 ? 'warn.missing1' : 'warn.missing', { n: missing.length }), items: missing.map((m) => missingLine(m, name)), action: 'missing' });
  }
  return out;
}

function missingLine({ id, where }, name) {
  const label = name(id);
  return `${label === id ? id : `${label} (${id})`} · ${where.join(', ')}`;
}

const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/i;

// Every entity id site.json names, with where it is used ("Kitchen", "Scenes" …).
export function configEntities(raw) {
  const found = new Map();
  const add = (id, where) => {
    if (typeof id !== 'string' || !ENTITY_ID.test(id)) return;
    if (!found.has(id)) found.set(id, []);
    if (where && !found.get(id).includes(where)) found.get(id).push(where);
  };
  const list = (v) => (Array.isArray(v) ? v : []);
  for (const plan of list(raw.floorplans)) {
    for (const room of list(plan?.rooms)) {
      const where = room?.name || room?.id || plan.name;
      for (const l of list(room?.lights)) add(l?.entity, where);
      add(room?.climate, where);
      add(room?.temperature, where);
      for (const id of list(room?.sensors)) add(id, where);
    }
  }
  const ov = raw.overview ?? {};
  for (const z of list(ov.zones)) for (const id of list(z?.lights)) add(id, `${t('editor.outdoor')}: ${z.name ?? z.id}`);
  for (const w of list(ov.windows)) for (const id of list(w?.lights)) add(id, t('missing.window'));
  for (const b of list(ov.buildings)) for (const id of list(b?.sensors)) add(id, b.name ?? b.id);
  add(ov.solar?.entity, t('missing.energy'));
  for (const c of list(raw.climates)) { add(c?.entity, c?.name ?? t('missing.heating')); add(c?.temperature, c?.name ?? t('missing.heating')); }
  for (const sc of list(raw.scenes)) add(sc?.entity, t('missing.scene'));
  for (const v of Object.values(raw.energy ?? {})) add(typeof v === 'string' ? v : v?.entity, t('missing.energy'));
  add(raw.weather, t('missing.weather'));
  const wall = raw.wall_screen ?? {};
  for (const b of [].concat(wall.doorbell ?? [])) { add(b?.entity, t('missing.doorbell')); add(b?.camera, t('missing.doorbell')); }
  for (const id of list(wall.idle?.wake)) add(id, t('missing.wake'));
  return [...found].map(([id, where]) => ({ id, where }));
}

// Entities in site.json that Home Assistant does not know (renamed or removed).
// Nothing is missing before the first states have arrived.
const configCache = new WeakMap();
export function missingEntities(site, store) {
  if (!store.size) return [];
  const raw = site.raw ?? site;
  if (!configCache.has(raw)) configCache.set(raw, configEntities(raw));
  return configCache.get(raw).filter(({ id }) => !store.get(id));
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
