import { t } from './i18n.js';
import { storage } from './util.js';

// Loads sites/<id>/site.json and builds lookup indexes the views share.
//
// In placement mode (#edit) an unsaved draft kept in this browser replaces the
// file, so changes made on screen survive a reload until they are copied into
// site.json. `site.raw` is an untouched copy of the config that the editor changes.

export const draftKey = (id) => `shd:${id}:draft`;

// Where site files come from:
// - standalone page: plain fetches from sites/<id>/ next to index.html
// - Home Assistant panel: a `loader` that fetches through HA's authenticated API,
//   so the plan and pictures are only served to logged-in users
const standaloneLoader = (base) => ({
  async get(path) { return fetch(`${base}${path}`, { cache: 'no-store' }); },
});

export async function loadSite(id, { useDraft = false, loader = null } = {}) {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error(t('site.invalidId', { id }));
  const base = `sites/${id}/`;
  const source = loader ?? standaloneLoader(base);
  let raw = useDraft ? storage.get(draftKey(id)) : null;
  const fromDraft = !!raw;
  if (!raw) {
    const res = await source.get('site.json');
    if (!res.ok) throw new Error(t('site.notFound', { path: `${base}site.json`, status: res.status }));
    try { raw = await res.json(); }
    catch (e) { throw new Error(t('site.invalidJson', { path: `${base}site.json`, msg: e.message })); }
  }
  const site = structuredClone(raw);
  site.raw = raw;
  site.fromDraft = fromDraft;
  site.id = id;
  site.base = base;
  if (loader) {
    // Authenticated files cannot be linked directly from <img>; fetch them once and use object URLs.
    const urls = new Map();
    await Promise.all(assetPaths(raw).map(async (p) => {
      try {
        const res = await loader.get(p);
        if (res.ok) urls.set(p, URL.createObjectURL(await res.blob()));
      } catch (e) { console.warn(`Could not load ${p}`, e); }
    }));
    site.asset = (path) => urls.get(path) ?? '';
  } else {
    // Files from the site folder get the dashboard version, past Home Assistant's long cache.
    site.asset = (path) => `${base}${path}${window.SHD_VERSION ? `?v=${encodeURIComponent(window.SHD_VERSION)}` : ''}`;
  }
  return index(site);
}

// Every picture a site config refers to.
function assetPaths(raw) {
  const paths = new Set();
  const ov = raw.overview;
  if (ov?.image) paths.add(ov.image);
  if (ov?.night_image) paths.add(ov.night_image);
  for (const plan of raw.floorplans ?? []) {
    if (plan.image) paths.add(typeof plan.image === 'string' ? plan.image : plan.image.src);
    for (const room of plan.rooms ?? []) if (room.photo) paths.add(room.photo);
  }
  return [...paths].filter(Boolean);
}

function index(site) {
  // The dashboard itself is Swedish by default; set "language": "en" for English.
  site.locale ??= 'sv-SE';
  site.language ??= 'sv';
  site.currency ??= 'SEK';
  site.floorplans ??= [];
  site.scenes ??= [];
  site.energy ??= {};

  const names = new Map();
  const lights = new Set(), climates = new Set(), temps = new Set();
  const roomById = new Map();

  for (const z of site.overview?.zones ?? []) {
    z.lights ??= [];
    // "lamps" is the full form; "glow": [[x, y, size], ...] is a shorthand for round lamps.
    z.lamps ??= (z.glow ?? []).map(([x, y, size]) => ({ at: [x, y], size, type: 'point' }));
    z.lights.forEach((id) => { lights.add(id); if (!names.has(id)) names.set(id, z.name); });
  }
  for (const plan of site.floorplans) {
    for (const room of plan.rooms ?? []) {
      room.plan = plan.id;
      room.lights ??= [];
      roomById.set(room.id, room);
      for (const l of room.lights) { lights.add(l.entity); names.set(l.entity, l.name ?? room.name); }
      if (room.climate) climates.add(room.climate);
      if (room.temperature) temps.add(room.temperature);
    }
  }

  // A building linked to a Home Assistant area but without a floor plan (a shed, a
  // workshop) works as a room: tapping it opens its area's lights, heating and sensors.
  for (const b of site.overview?.buildings ?? []) {
    if (!b.ha_area || b.floorplan) continue;
    roomById.set(`building:${b.id}`, { id: `building:${b.id}`, name: b.name, ha_area: b.ha_area, lights: [], plan: null, building: b.id, sensors: b.sensors });
  }

  // Climate devices that are not a room, such as a heat pump: listed in the heating card.
  for (const c of site.climates ?? []) {
    const room = { id: `climate:${c.entity}`, name: c.name ?? c.entity, climate: c.entity, temperature: c.temperature, lights: [], plan: null, device: true };
    roomById.set(room.id, room);
    climates.add(c.entity);
  }

  site.index = {
    names,
    lights: [...lights],
    climates: [...climates],
    temps: [...temps],
    rooms: roomById,
    climateRooms: [...roomById.values()].filter((r) => r.climate || r.temperature),
  };
  return site;
}

export const lightName = (site, id) => site.index.names.get(id) ?? id;
