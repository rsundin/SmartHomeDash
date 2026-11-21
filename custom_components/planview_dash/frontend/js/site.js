import { t, languageReady, localeFor } from './i18n.js';
import { storage, stripOf, stripCentre } from './util.js';

// Loads sites/<id>/site.json and builds lookup indexes the views share.
//
// In placement mode (#edit) an unsaved draft kept in this browser replaces the
// file, so changes made on screen survive a reload until they are copied into
// site.json. `site.raw` is an untouched copy of the config that the editor changes.

export const draftKey = (id) => `pvd:${id}:draft`;
// The version of site.json a draft was started from, so saving it later can tell whether
// the file has been saved by someone else in between.
export const draftBaseKey = (id) => `pvd:${id}:draftBase`;
// Set by the missing-devices warning: placement mode then lists only those devices.
export const missingFilterKey = (id) => `pvd:${id}:editmissing`;

// The site.json format this version reads and writes. A file without "format" is
// format 1. When the format changes, FORMAT goes up by one and a step that turns a
// format n file into n + 1 is added to MIGRATIONS (index 0 upgrades 1 to 2, and so on).
// The same steps are in Python (views.py migrate_site), which runs them before the check
// on save and import. A file from a newer version than this is shown but never saved over.
export const FORMAT = 1;
export const MIGRATIONS = [];

// The format a config says it has: a whole number from 1, or null when it says
// something that is not a format.
export function formatOf(raw) {
  const f = raw?.format ?? 1;
  return Number.isInteger(f) && f >= 1 ? f : null;
}

// Upgrades a config to FORMAT in place, and returns it. A config from a newer version
// (or with a format that is not a number) is left as it is: see site.tooNew.
export function migrate(raw) {
  let f = formatOf(raw);
  if (f === null || f > FORMAT) return raw;
  for (; f < FORMAT; f++) MIGRATIONS[f - 1](raw);
  // "format" first, so it is the first thing seen when the file is opened by hand.
  const rest = { ...raw };
  delete rest.format;
  for (const k of Object.keys(raw)) delete raw[k];
  return Object.assign(raw, { format: FORMAT }, rest);
}

// Where site files come from:
// - standalone page: plain fetches from sites/<id>/ next to index.html
// - Home Assistant panel: a `loader` that fetches through HA's authenticated API,
//   so the plan and pictures are only served to logged-in users
const standaloneLoader = (base) => ({
  async get(path) { return fetch(`${base}${path}`, { cache: 'no-store' }); },
});

export async function loadSite(id, { useDraft = false, loader = null, allPictures = false } = {}) {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error(t('site.invalidId', { id }));
  const base = `sites/${id}/`;
  const source = loader ?? standaloneLoader(base);
  let raw = useDraft ? storage.get(draftKey(id)) : null;
  const fromDraft = !!raw;
  // The version of the file the config was read from (Home Assistant sends it as ETag);
  // a save names it, and is refused if the file has changed since (main.js saveSite).
  let version = fromDraft ? storage.get(draftBaseKey(id)) : null;
  if (!raw) {
    const res = await source.get('site.json');
    version = res.headers?.get('ETag') ?? null;
    // The texts may still be on their way this early: wait, so the message is not a bare key.
    if (!res.ok) { await languageReady(); throw new Error(t('site.notFound', { path: `${base}site.json`, status: res.status })); }
    try { raw = await res.json(); }
    catch (e) { await languageReady(); throw new Error(t('site.invalidJson', { path: `${base}site.json`, msg: e.message })); }
  }
  // Older files are upgraded here, so everything after this (views, placement mode, the
  // setup guide, saving, Copy site.json) sees the current format.
  const format = formatOf(raw);
  const tooNew = format === null || format > FORMAT;
  if (!tooNew) migrate(raw);
  const site = structuredClone(raw);
  site.raw = raw;
  // Saved by a newer PlanView Dash (or "format" is not a number): shown, never saved over.
  site.tooNew = tooNew;
  site.fromDraft = fromDraft;
  site.version = version;
  site.id = id;
  site.base = base;
  if (loader) {
    // Authenticated files cannot be linked directly from <img>; each is fetched once and
    // used through an object URL.
    const urls = new Map();
    const loading = new Map(); // path -> promise, settled when the picture is in (or failed)
    let disposed = false;
    const fetchOne = (p) => {
      if (!loading.has(p)) {
        loading.set(p, (async () => {
          try {
            const res = await loader.get(p);
            if (!res.ok) return;
            const blob = await res.blob();
            if (!disposed) urls.set(p, URL.createObjectURL(blob));
          } catch (e) { console.warn(`Could not load ${p}`, e); }
        })());
      }
      return loading.get(p);
    };
    const all = assetPaths(raw);
    site.asset = (path) => urls.get(path) ?? '';
    // Resolves when the given pictures (all of them without a list) can be shown with
    // asset(). A picture that could not be fetched resolves too, and stays empty.
    site.pictures = (paths = all) => Promise.all(paths.filter(Boolean).map(fetchOne)).then(() => {});
    // The pictures stay in memory until their addresses are released: main.js does so
    // when the dashboard restarts in place, or a wall screen would grow with every save.
    site.dispose = () => { disposed = true; for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); };
    // Only the overview's pictures are waited for, so a home with many floor plans and
    // room photos shows as fast as a small one. The rest follow in the background, and
    // whoever shows one waits for it with pictures() (main.js showPlan, the room panel).
    // Placement mode shows every plan at once and asks for all of them.
    const ov = raw.overview;
    await site.pictures(allPictures ? all : [ov?.image, ov?.night_image]);
    if (!allPictures) site.pictures();
  } else {
    // Files from the site folder get the dashboard version, past Home Assistant's long cache.
    site.asset = (path) => `${base}${path}${window.PVD_VERSION ? `?v=${encodeURIComponent(window.PVD_VERSION)}` : ''}`;
    site.pictures = () => Promise.resolve();
  }
  return index(site);
}

// The picture of a floor plan, as the path asset() and pictures() take.
export const planPicture = (plan) => (plan?.image ? (typeof plan.image === 'string' ? plan.image : plan.image.src) : null);

// Every picture a site config refers to.
function assetPaths(raw) {
  const paths = new Set();
  const ov = raw.overview;
  if (ov?.image) paths.add(ov.image);
  if (ov?.night_image) paths.add(ov.night_image);
  for (const plan of raw.floorplans ?? []) {
    paths.add(planPicture(plan));
    for (const room of plan.rooms ?? []) if (room.photo) paths.add(room.photo);
  }
  return [...paths].filter(Boolean);
}

function index(site) {
  // The dashboard itself is Swedish by default; "language" picks another (i18n.js
  // LANGUAGES), and numbers and dates follow that language unless "locale" says otherwise.
  site.language ??= 'sv';
  site.locale ??= localeFor(site.language);
  site.currency ??= 'SEK';
  site.floorplans ??= [];
  site.scenes ??= [];
  site.energy ??= {};

  const names = new Map();
  // Names given to entities in site.json itself; they win over Home Assistant's (entities.js nameOf).
  const labels = new Map();
  const label = (id, name) => { if (id && name) labels.set(id, name); };
  const lights = new Set(), climates = new Set(), temps = new Set();
  const roomById = new Map();

  for (const z of site.overview?.zones ?? []) {
    z.lights ??= [];
    // "lamps" is the full form; "glow": [[x, y, size], ...] is a shorthand for round lamps.
    z.lamps ??= (z.glow ?? []).map(([x, y, size]) => ({ at: [x, y], size, type: 'point' }));
    // An LED strip (`line` or `area`) has its middle as its place, for everything that asks where a lamp is.
    for (const l of z.lamps) { const strip = stripOf(l); if (strip) { l.at ??= stripCentre(strip.points); l.size ??= 30; } }
    z.lamps = z.lamps.filter((l) => Array.isArray(l?.at));
    z.lights.forEach((id) => { lights.add(id); if (!names.has(id)) names.set(id, z.name); });
  }
  for (const plan of site.floorplans) {
    for (const room of plan.rooms ?? []) {
      room.plan = plan.id;
      room.lights ??= [];
      roomById.set(room.id, room);
      for (const l of room.lights) { lights.add(l.entity); names.set(l.entity, l.name ?? room.name); label(l.entity, l.name); }
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
    label(c.entity, c.name);
    const room = { id: `climate:${c.entity}`, name: c.name ?? c.entity, climate: c.entity, temperature: c.temperature, lights: [], plan: null, device: true };
    roomById.set(room.id, room);
    climates.add(c.entity);
  }

  for (const sc of site.scenes) label(sc.entity, sc.name);
  for (const c of [...site.floorplans.flatMap((p) => p.cameras ?? []), ...(site.overview?.cameras ?? [])]) label(c?.entity, c?.name);
  for (const b of [].concat(site.wall_screen?.doorbell ?? [])) { label(b?.entity, b?.name); label(b?.camera, b?.name); }

  site.index = {
    names,
    labels,
    lights: [...lights],
    climates: [...climates],
    temps: [...temps],
    rooms: roomById,
    climateRooms: [...roomById.values()].filter((r) => r.climate || r.temperature),
  };
  return site;
}

export const lightName = (site, id) => site.index.names.get(id) ?? id;
