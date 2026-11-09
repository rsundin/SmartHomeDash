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

export const noAreas = () => ({ list: [], byId: new Map(), entityArea: new Map(), floors: [], floorById: new Map() });

export async function loadAreas(adapter) {
  if (!adapter.areas) return noAreas();
  try {
    return resolve(await adapter.areas());
  } catch (e) {
    console.warn('Could not read Home Assistant areas', e);
    return noAreas();
  }
}

export function resolve({ areas = [], entities = [], devices = [], floors = [] } = {}) {
  const byId = new Map(areas.map((a) => [a.area_id, a]));
  const deviceArea = new Map(devices.map((d) => [d.id, d.area_id]));
  const entityArea = new Map();
  for (const e of entities) {
    const area = e.area_id || deviceArea.get(e.device_id);
    if (area && byId.has(area)) entityArea.set(e.entity_id, area);
  }
  const list = [...byId.values()];
  const floorList = [...floors].sort((x, y) => (x.level ?? 0) - (y.level ?? 0));
  return { list, byId, entityArea, floors: floorList, floorById: new Map(floorList.map((f) => [f.floor_id, f])) };
}

export const areaName = (areas, id) => areas.byId.get(id)?.name ?? null;
export const areaOf = (areas, entityId) => areas.entityArea.get(entityId) ?? null;

export const floorName = (areas, id) => areas.floorById?.get(id)?.name ?? null;

// Rooms linked to an area show the area's name as it is now in Home Assistant, and
// floor plans linked to a floor show the floor's name and come in floor order.
export function applyAreaNames(site, areas) {
  for (const plan of site.floorplans) {
    const name = plan.ha_floor && floorName(areas, plan.ha_floor);
    if (name) plan.name = name;
  }
  const level = (p) => areas.floorById?.get(p.ha_floor)?.level;
  if (site.floorplans.some((p) => level(p) != null)) {
    const order = new Map(site.floorplans.map((p, i) => [p, i]));
    site.floorplans.sort((x, y) => {
      const lx = level(x), ly = level(y);
      if (lx == null || ly == null) return lx == null && ly == null ? order.get(x) - order.get(y) : lx == null ? 1 : -1;
      return lx - ly || order.get(x) - order.get(y);
    });
  }
  for (const b of site.overview?.buildings ?? []) {
    const name = b.ha_area && areaName(areas, b.ha_area);
    if (name) b.name = name;
  }
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
  const floors = new Map((areas.floors ?? []).map((f) => [key(f.name), f]));
  for (const plan of cfg.floorplans ?? []) {
    const f = !plan.ha_floor && floors.get(key(plan.name));
    if (f) { plan.ha_floor = f.floor_id; plan.name = f.name; }
  }
  for (const plan of cfg.floorplans ?? []) {
    for (const room of plan.rooms ?? []) {
      if (room.ha_area) continue;
      const a = byName.get(key(room.name));
      if (a) { room.ha_area = a.area_id; room.name = a.name; matched.push(room); }
    }
  }
  // Buildings on the overview picture too (a shed named like its area).
  for (const b of cfg.overview?.buildings ?? []) {
    if (b.ha_area) continue;
    const a = byName.get(key(b.name));
    if (a && !matched.some((r) => r.ha_area === a.area_id)) { b.ha_area = a.area_id; b.name = a.name; }
  }
  return matched;
}

// ---------- automatic placement at runtime
// Nothing here is saved: it fills in what site.json leaves out, from Home Assistant,
// every time the dashboard starts. Placing an entity in placement mode saves its spot.

const nameKey = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

// A room without an area, named exactly like one, is treated as linked to it.
export function linkByName(site, areas) {
  const byName = new Map(areas.list.map((x) => [nameKey(x.name), x]));
  const taken = new Set([...site.index.rooms.values()].map((r) => r.ha_area).filter(Boolean));
  for (const room of site.index.rooms.values()) {
    if (room.ha_area || room.device) continue;
    const match = byName.get(nameKey(room.name));
    if (match && !taken.has(match.area_id)) { room.ha_area = match.area_id; room.areaByName = true; taken.add(match.area_id); }
  }
}

// Lights, a thermostat and a temperature sensor that are in a room's area in Home
// Assistant but not in site.json show up in that room: lights in a ring around the
// middle of the room (marked auto), to be moved to their real spot in placement mode.
export function autoPlace(site, areas, store) {
  if (!areas.entityArea.size) return [];
  const used = usedEntities(site);
  const added = [];
  for (const room of site.index.rooms.values()) {
    if (!room.ha_area || !(room.plan && room.area) && !room.building) continue;
    const found = entitiesInArea(areas, room.ha_area, store);
    const lights = found.lights.filter((s) => !used.has(s.entity_id));
    if (lights.length && room.building) {
      // No floor plan to draw them on: listed in the building's panel.
      for (const s of lights) {
        const name = s.attributes?.friendly_name ?? s.entity_id;
        room.lights.push({ entity: s.entity_id, name, auto: true });
        site.index.lights.push(s.entity_id);
        site.index.names.set(s.entity_id, name);
        used.add(s.entity_id);
        added.push(s.entity_id);
      }
    } else if (lights.length) {
      const [cx, cy] = centroid(room.area);
      const box = bbox([room.area]);
      const r = lights.length > 1 ? Math.min(box.w, box.h) * 0.22 : 0;
      lights.forEach((s, i) => {
        const a = (i / lights.length) * Math.PI * 2 - Math.PI / 2;
        const name = s.attributes?.friendly_name ?? s.entity_id;
        room.lights.push({ entity: s.entity_id, name, at: [cx + Math.cos(a) * r, cy + Math.sin(a) * r], auto: true });
        site.index.lights.push(s.entity_id);
        site.index.names.set(s.entity_id, name);
        used.add(s.entity_id);
        added.push(s.entity_id);
      });
    }
    const climate = found.climates.find((s) => !used.has(s.entity_id));
    if (!room.climate && climate) { room.climate = climate.entity_id; room.autoClimate = true; site.index.climates.push(climate.entity_id); used.add(climate.entity_id); added.push(climate.entity_id); }
    const temp = found.temps.find((s) => !used.has(s.entity_id));
    if (!room.temperature && temp) { room.temperature = temp.entity_id; site.index.temps.push(temp.entity_id); used.add(temp.entity_id); added.push(temp.entity_id); }
  }
  site.index.climateRooms = [...site.index.rooms.values()].filter((r) => r.climate || r.temperature);
  return added;
}
