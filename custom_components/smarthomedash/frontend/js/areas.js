// Home Assistant areas: their names, and which area each entity belongs to.
//
// An entity is in an area either directly or through its device, the same rule
// Home Assistant uses. Rooms in site.json link to an area with "ha_area": the room
// then shows the area's current name, and the setup guide can fill it with the
// area's lights, thermostat and temperature sensor.
//
// Adapters provide raw registries through `areas()`:
//   { areas: [{ area_id, name }], entities: [{ entity_id, area_id, device_id }], devices: [{ id, area_id }] }
// Everything here works without areas too: an installation that does not use them
// keeps typed room names and manual placement.

import { centroid, bbox } from './util.js';

export const noAreas = () => ({ list: [], byId: new Map(), entityArea: new Map() });

export async function loadAreas(adapter) {
  if (!adapter.areas) return noAreas();
  try {
    return resolve(await adapter.areas());
  } catch (e) {
    console.warn('Could not read Home Assistant areas', e);
    return noAreas();
  }
}

export function resolve({ areas = [], entities = [], devices = [] } = {}) {
  const byId = new Map(areas.map((a) => [a.area_id, a]));
  const deviceArea = new Map(devices.map((d) => [d.id, d.area_id]));
  const entityArea = new Map();
  for (const e of entities) {
    const area = e.area_id || deviceArea.get(e.device_id);
    if (area && byId.has(area)) entityArea.set(e.entity_id, area);
  }
  const list = [...byId.values()];
  return { list, byId, entityArea };
}

export const areaName = (areas, id) => areas.byId.get(id)?.name ?? null;
export const areaOf = (areas, entityId) => areas.entityArea.get(entityId) ?? null;

// Rooms linked to an area show the area's name as it is now in Home Assistant.
export function applyAreaNames(site, areas) {
  for (const room of site.index.rooms.values()) {
    const name = room.ha_area && areaName(areas, room.ha_area);
    if (!name || name === room.name) continue;
    for (const l of room.lights) if (site.index.names.get(l.entity) === room.name && !l.name) site.index.names.set(l.entity, name);
    room.name = name;
  }
}

const isLight = (s) => s.entity_id.startsWith('light.');
const isClimate = (s) => s.entity_id.startsWith('climate.');
const isTemp = (s) => s.entity_id.startsWith('sensor.')
  && (s.attributes?.device_class === 'temperature' || /°C|°F/.test(s.attributes?.unit_of_measurement || ''));

// The entities in an area that a room can show, sorted by name.
export function entitiesInArea(areas, areaId, store) {
  const byName = (a, b) => (a.attributes?.friendly_name ?? a.entity_id).localeCompare(b.attributes?.friendly_name ?? b.entity_id);
  const inArea = store.all().filter((s) => areas.entityArea.get(s.entity_id) === areaId).sort(byName);
  return { lights: inArea.filter(isLight), climates: inArea.filter(isClimate), temps: inArea.filter(isTemp) };
}

// Every entity id a site config already uses somewhere.
export function usedEntities(cfg) {
  const used = new Set();
  for (const plan of cfg.floorplans ?? []) {
    for (const room of plan.rooms ?? []) {
      for (const l of room.lights ?? []) used.add(l.entity);
      if (room.climate) used.add(room.climate);
      if (room.temperature) used.add(room.temperature);
    }
  }
  for (const z of cfg.overview?.zones ?? []) for (const id of z.lights ?? []) used.add(id);
  for (const c of cfg.climates ?? []) used.add(c.entity);
  return used;
}

// Adds the area's lights, thermostat and temperature sensor to a room in a raw config.
// Lights not used anywhere yet are set out in a small ring around the room's centre,
// to be moved to their real spot in placement mode. Returns the number added.
export function fillRoomFromArea(cfg, room, areas, store) {
  if (!room.ha_area) return 0;
  const found = entitiesInArea(areas, room.ha_area, store);
  const used = usedEntities(cfg);
  let added = 0;
  const lights = found.lights.filter((s) => !used.has(s.entity_id));
  if (lights.length) {
    const [cx, cy] = centroid(room.area);
    const box = bbox([room.area]);
    const r = lights.length > 1 ? Math.min(box.w, box.h) * 0.22 : 0;
    room.lights ??= [];
    lights.forEach((s, i) => {
      const a = (i / lights.length) * Math.PI * 2 - Math.PI / 2;
      room.lights.push({
        entity: s.entity_id,
        name: s.attributes?.friendly_name ?? s.entity_id,
        at: [Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)],
      });
      added++;
    });
  }
  const climate = found.climates.find((s) => !used.has(s.entity_id));
  if (!room.climate && climate) { room.climate = climate.entity_id; added++; }
  const temp = found.temps.find((s) => !used.has(s.entity_id));
  if (!room.temperature && temp) { room.temperature = temp.entity_id; added++; }
  return added;
}

// Links rooms without an area to the area of the same name (case and accents ignored).
export function matchRoomsByName(cfg, areas) {
  const key = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const byName = new Map(areas.list.map((a) => [key(a.name), a]));
  const matched = [];
  for (const plan of cfg.floorplans ?? []) {
    for (const room of plan.rooms ?? []) {
      if (room.ha_area) continue;
      const a = byName.get(key(room.name));
      if (a) { room.ha_area = a.area_id; room.name = a.name; matched.push(room); }
    }
  }
  return matched;
}
