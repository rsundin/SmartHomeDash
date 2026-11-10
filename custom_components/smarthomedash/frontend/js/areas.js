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
import { nameOf } from './entities.js';

export const noAreas = () => ({ list: [], byId: new Map(), entityArea: new Map(), floors: [], floorById: new Map(), entityReg: new Map(), deviceReg: new Map() });

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
  return {
    list, byId, entityArea, floors: floorList, floorById: new Map(floorList.map((f) => [f.floor_id, f])),
    // The registries themselves, for names as Home Assistant shows them (nameOf in entities.js).
    entityReg: new Map(entities.map((e) => [e.entity_id, e])),
    deviceReg: new Map(devices.map((d) => [d.id, d])),
  };
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
  const name = (s) => nameOf(s.entity_id, { store, areas });
  const byName = (a, b) => name(a).localeCompare(name(b));
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
        name: nameOf(s.entity_id, { store, areas }),
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
  const tiles = new Set(site.floorplans.filter((p) => p.layout === 'tiles' && !p.image).map((p) => p.id));
  for (const room of site.index.rooms.values()) {
    if (!room.ha_area || !(room.plan && room.area) && !room.building) continue;
    const found = entitiesInArea(areas, room.ha_area, store);
    const lights = found.lights.filter((s) => !used.has(s.entity_id));
    if (lights.length && room.building) {
      // No floor plan to draw them on: listed in the building's panel.
      for (const s of lights) {
        const name = nameOf(s.entity_id, { store, areas });
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
      // On a tile from the quick start, in a row below the room's name and temperature.
      const tile = tiles.has(room.plan);
      lights.forEach((s, i) => {
        const a = (i / lights.length) * Math.PI * 2 - Math.PI / 2;
        const name = nameOf(s.entity_id, { store, areas });
        const at = tile
          ? [box.x + (box.w * (i + 1)) / (lights.length + 1), box.y + box.h * 0.8]
          : [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
        room.lights.push({ entity: s.entity_id, name, at, auto: true });
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
  // Outdoor lamps on the overview picture: a zone belongs to the area its lights are in,
  // and the area's other lights that are nowhere yet switch with it.
  for (const z of site.overview?.zones ?? []) {
    const area = z.ha_area ?? z.lights.map((id) => areas.entityArea.get(id)).find(Boolean);
    if (!area || [...site.index.rooms.values()].some((r) => r.ha_area === area)) continue;
    for (const s of entitiesInArea(areas, area, store).lights) {
      if (used.has(s.entity_id)) continue;
      z.lights.push(s.entity_id);
      (z.autoLights ??= []).push(s.entity_id);
      site.index.lights.push(s.entity_id);
      if (!site.index.names.has(s.entity_id)) site.index.names.set(s.entity_id, z.name);
      used.add(s.entity_id);
      added.push(s.entity_id);
    }
  }
  site.index.climateRooms = [...site.index.rooms.values()].filter((r) => r.climate || r.temperature);
  return added;
}

// ---------- quick start: floor plans from Home Assistant floors and areas
// Before anything is drawn: one floor plan per Home Assistant floor, with a tile per
// area on it, linked with ha_area. Areas without a floor share one plan. The tiles
// are rectangles on a plan without a picture ("layout": "tiles"); lights, thermostats
// and temperature sensors are not written, they are placed by autoPlace at start.

const TILE = { width: 1200, row: 300, gap: 30 };

// Rows of tiles, each row as wide as the plan, a tile's width following its weight.
// items: [{ weight }] in order; returns [[x, y], ...] rectangles in the same order.
export function tileLayout(items) {
  if (!items.length) return [];
  // Rows as even as they can be: 4 tiles make 2 + 2, 9 make 3 + 3 + 3.
  const rowCount = Math.ceil(items.length / Math.ceil(Math.sqrt(items.length * 1.5)));
  const perRow = Math.ceil(items.length / rowCount);
  const rows = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));
  const avg = items.reduce((s, x) => s + x.weight, 0) / rows.length;
  const out = [];
  rows.forEach((row, ri) => {
    // A short last row keeps the tile sizes of the rows above instead of stretching.
    const total = Math.max(row.reduce((s, x) => s + x.weight, 0), ri === rows.length - 1 ? avg : 0);
    const free = TILE.width - TILE.gap * (row.length - 1);
    let x = 0;
    const y = ri * (TILE.row + TILE.gap);
    for (const item of row) {
      const w = Math.round((free * item.weight) / total);
      out.push([[x, y], [x + w, y], [x + w, y + TILE.row], [x, y + TILE.row]]);
      x += w + TILE.gap;
    }
  });
  return out;
}

// Adds the plans to a raw config. Areas already linked to a room or a building, and
// floors that already have a plan, are left alone. Returns { plans, rooms } added.
export function quickStart(cfg, areas, { otherName = 'Other rooms', homeName = 'Home' } = {}) {
  cfg.floorplans ??= [];
  const used = new Set([
    ...cfg.floorplans.flatMap((p) => (p.rooms ?? []).map((r) => r.ha_area)),
    ...(cfg.overview?.buildings ?? []).map((b) => b.ha_area),
  ].filter(Boolean));
  const planned = new Set(cfg.floorplans.map((p) => p.ha_floor).filter(Boolean));
  const devices = new Map();
  for (const area of areas.entityArea.values()) devices.set(area, (devices.get(area) ?? 0) + 1);
  const floors = areas.floors ?? [];
  const known = new Set(floors.map((f) => f.floor_id));
  const groups = floors.map((f) => ({ floor: f, list: [] }));
  const loose = { floor: null, list: [] };
  const sorted = [...areas.list].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  for (const a of sorted) {
    if (used.has(a.area_id)) continue;
    const g = known.has(a.floor_id) ? groups.find((x) => x.floor.floor_id === a.floor_id) : loose;
    if (g.floor && planned.has(g.floor.floor_id)) continue;
    g.list.push(a);
  }
  const ids = cfg.floorplans.flatMap((p) => [p.id, ...(p.rooms ?? []).map((r) => r.id)]);
  const unique = (base) => {
    const clean = nameKey(base).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item';
    let id = clean, i = 2;
    while (ids.includes(id)) id = `${clean}_${i++}`;
    ids.push(id);
    return id;
  };
  let plans = 0, rooms = 0;
  for (const g of [...groups, loose]) {
    if (!g.list.length) continue;
    // A device or two makes a small tile; a busy room a wider one.
    const tiles = tileLayout(g.list.map((a) => ({ weight: 1 + Math.min(devices.get(a.area_id) ?? 0, 12) / 6 })));
    const bb = bbox(tiles);
    const name = g.floor?.name ?? (floors.length ? otherName : homeName);
    cfg.floorplans.push({
      id: unique(g.floor?.floor_id ?? name),
      name,
      ...(g.floor ? { ha_floor: g.floor.floor_id } : {}),
      unit: 'px',
      layout: 'tiles',
      outline: [[bb.x, bb.y], [bb.x + bb.w, bb.y], [bb.x + bb.w, bb.y + bb.h], [bb.x, bb.y + bb.h]],
      rooms: g.list.map((a, i) => ({ id: unique(a.area_id), name: a.name, ha_area: a.area_id, area: tiles[i], lights: [] })),
    });
    plans++;
    rooms += g.list.length;
  }
  return { plans, rooms };
}

// A plan from the quick start gets its picture: the tiles are stretched over the picture,
// to be drawn again where the rooms really are. Lights placed on a tile move along.
export function fitTilesToPicture(plan, [w, h]) {
  const bb = bbox([plan.outline ?? (plan.rooms ?? []).flatMap((r) => r.area)]);
  const sx = w / (bb.w || 1), sy = h / (bb.h || 1);
  const map = ([x, y]) => [Math.round((x - bb.x) * sx), Math.round((y - bb.y) * sy)];
  for (const room of plan.rooms ?? []) {
    room.area = room.area.map(map);
    if (room.label) room.label = map(room.label);
    for (const l of room.lights ?? []) if (l.at) l.at = map(l.at);
    room.redraw = true;
  }
  plan.outline = [[0, 0], [w, 0], [w, h], [0, h]];
  delete plan.layout;
}
