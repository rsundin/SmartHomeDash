// Placement mode, opened by adding #edit to the address.
//
// Place:  pick a light, switch, thermostat or temperature sensor from the list,
//         then tap where it is. On a floor plan the room is found from the tap
//         (point in polygon); on the overview a light becomes an outdoor lamp.
// Draw:   click corners to get a polygon for site.json (rooms, buildings, panels).
//
// Changes are kept as a draft in this browser and applied by reloading the page.
// "Copy site.json" puts the result on the clipboard to paste into the real file.

import { el, svgPoint, inside, storage } from '../util.js';
import { draftKey } from '../site.js';
import { t } from '../i18n.js';
import { areaOf, areaName } from '../areas.js';

const KINDS = [
  { id: 'lights', label: 'editor.kindLights', match: (s) => /^(light|switch)\./.test(s.entity_id) },
  { id: 'climate', label: 'editor.kindClimate', match: (s) => s.entity_id.startsWith('climate.') },
  { id: 'temperature', label: 'editor.kindTemp', match: (s) => s.entity_id.startsWith('sensor.') && (s.attributes?.device_class === 'temperature' || /°C|°F/.test(s.attributes?.unit_of_measurement || '')) },
];

export function createEditor({ site, store, saveSite = null, reload = () => location.reload(), exit = null, update = null, reloadPage = () => location.reload() }) {
  const raw = site.raw;
  const viewKey = `shd:${site.id}:editview`;
  let mode = 'place';
  let selected = null;
  let filter = '';
  // draw mode
  let points = [];
  let drawTarget = null;

  // ---------- where is each entity placed in the raw config?
  function placementOf(id) {
    for (const plan of raw.floorplans ?? []) {
      for (const room of plan.rooms ?? []) {
        if ((room.lights ?? []).some((l) => l.entity === id)) return room.name;
        if (room.climate === id || room.temperature === id) return room.name;
      }
    }
    const device = (raw.climates ?? []).find((c) => c.entity === id);
    if (device) return device.name ?? id;
    const zone = (raw.overview?.zones ?? []).find((z) => (z.lights ?? []).includes(id));
    return zone ? `${t('editor.outdoor')}: ${zone.name}` : null;
  }

  function unplace(id) {
    for (const plan of raw.floorplans ?? []) {
      for (const room of plan.rooms ?? []) {
        if (room.lights) room.lights = room.lights.filter((l) => l.entity !== id);
        if (room.climate === id) delete room.climate;
        if (room.temperature === id) delete room.temperature;
      }
    }
    if (raw.overview?.zones) {
      for (const z of raw.overview.zones) z.lights = (z.lights ?? []).filter((x) => x !== id);
      raw.overview.zones = raw.overview.zones.filter((z) => z.lights.length);
    }
  }

  const nameOf = (id) => store.get(id)?.attributes?.friendly_name ?? site.index.names.get(id) ?? id;
  const kindOf = (id) => KINDS.find((k) => k.match(store.get(id) ?? { entity_id: id, attributes: {} }))?.id;

  function save(message) {
    storage.set(draftKey(site.id), raw);
    storage.set(viewKey, currentView());
    status.textContent = message;
    setTimeout(reload, 350);
  }
  const currentView = () => document.querySelector('.stage')?.dataset.view ?? null;

  // ---------- place on a floor plan
  function placeInPlan(plan, at) {
    const id = selected;
    const kind = kindOf(id);
    const rawPlan = (raw.floorplans ?? []).find((p) => p.id === plan.id);
    const room = (rawPlan?.rooms ?? []).find((r) => inside(at, r.area));
    if (!room) { status.textContent = t('editor.outsideRooms'); return; }
    const existing = (room.lights ?? []).find((l) => l.entity === id);
    unplace(id);
    if (kind === 'lights') {
      room.lights ??= [];
      room.lights.push({ entity: id, name: existing?.name ?? nameOf(id), at: at.map(Math.round) });
    } else if (kind === 'climate') {
      room.climate = id;
    } else if (kind === 'temperature') {
      room.temperature = id;
    }
    save(t('editor.placedIn', { name: nameOf(id), room: room.name }));
  }

  // ---------- place on the overview (outdoor lamp)
  function placeOutdoor(at) {
    const id = selected;
    if (kindOf(id) !== 'lights') { status.textContent = t('editor.onlyLightsOutdoor'); return; }
    raw.overview.zones ??= [];
    let zone = raw.overview.zones.find((z) => (z.lights ?? []).includes(id));
    if (!zone) {
      unplace(id);
      zone = { id: id.split('.')[1], name: nameOf(id), lights: [id], lamps: [] };
      raw.overview.zones.push(zone);
    }
    zone.lamps ??= [];
    zone.lamps.push({ at: at.map(Math.round), type: 'wall', size: 30 });
    save(t('editor.placedOutdoor', { name: zone.name, n: zone.lamps.length }));
  }

  // ---------- UI
  const status = el('p', { class: 'small editor-status', role: 'status' });
  const search = el('input', { id: 'editor-search', type: 'search', placeholder: t('editor.search'), class: 'editor-search' });
  const list = el('div', { class: 'editor-list' });
  const selBox = el('div', { class: 'editor-sel' });
  const tabs = el('div', { class: 'seg' });
  const out = el('code', { class: 'editor-out' });
  const placePane = el('div', { class: 'editor-pane' }, search, list, selBox);
  const drawPane = el('div', { class: 'editor-pane', hidden: true },
    el('p', { class: 'small' }, t('editor.drawHelp')), out,
    el('div', { class: 'row' },
      el('button', { class: 'chip', type: 'button', onclick: () => copyText(out.textContent) }, t('editor.copy')),
      el('button', { class: 'chip', type: 'button', onclick: () => { points.pop(); renderDraw(); } }, t('editor.undo')),
      el('button', { class: 'chip', type: 'button', onclick: () => { points = []; renderDraw(); } }, t('editor.clear'))));

  const draftRow = el('div', { class: 'row' },
    saveSite ? el('button', { class: 'chip chip-primary', type: 'button', onclick: () => saveToHa() }, t('editor.saveHa')) : null,
    el('button', { class: `chip${saveSite ? '' : ' chip-primary'}`, type: 'button', onclick: () => copyText(JSON.stringify(raw, null, 2), t('editor.copiedJson')) }, t('editor.copyJson')),
    el('button', { class: 'chip', type: 'button', onclick: download }, t('editor.download')),
    site.fromDraft ? el('button', { class: 'chip chip-danger', type: 'button', onclick: discard }, t('editor.discard')) : null);

  const root = el('aside', { class: 'editor', 'aria-label': t('editor.title') },
    el('div', { class: 'row-between' },
      el('p', { class: 'eyebrow' }, t('editor.title')),
      exit
        ? el('button', { class: 'chip editor-exit', type: 'button', onclick: () => { storage.set(viewKey, null); exit(); } }, t('editor.exit'))
        : el('a', { class: 'small editor-exit', href: location.pathname + location.search, onclick: () => storage.set(viewKey, null) }, t('editor.exit'))),
    site.fromDraft ? el('p', { class: 'small editor-draft' }, t('editor.draftNotice')) : null,
    tabs, placePane, drawPane, status, draftRow,
    update ? el('div', { class: 'row editor-update' },
      el('button', { class: 'chip', type: 'button', onclick: (e) => runUpdate(e.currentTarget) }, t('editor.update'))) : null);

  // Install the latest version from GitHub, then reload so the new code runs.
  async function runUpdate(btn) {
    btn.disabled = true;
    status.textContent = t('editor.updating');
    try {
      const r = await update();
      if (r.restart_required) {
        status.textContent = t('editor.updatedRestart', { commit: r.commit ?? '' });
        btn.disabled = false;
      } else {
        status.textContent = t('editor.updatedReload', { commit: r.commit ?? '' });
        setTimeout(reloadPage, 1200);
      }
    } catch (e) {
      status.textContent = t('editor.updateFailed', { msg: e?.message ?? String(e) });
      btn.disabled = false;
    }
  }

  for (const [m, label] of [['place', t('editor.tabPlace')], ['draw', t('editor.tabDraw')]]) {
    tabs.append(el('button', { type: 'button', 'data-mode': m, class: m === mode ? 'is-active' : '', onclick: () => setMode(m) }, label));
  }
  function setMode(m) {
    mode = m;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === m));
    placePane.hidden = m !== 'place';
    drawPane.hidden = m !== 'draw';
    status.textContent = m === 'draw' ? t('editor.drawPrompt') : selected ? t('editor.tapWhere') : t('editor.pickFirst');
  }

  search.addEventListener('input', () => { filter = search.value.trim().toLowerCase(); renderList(); });

  function entities() {
    const all = [];
    const seen = new Set();
    const add = (s) => { if (!seen.has(s.entity_id)) { seen.add(s.entity_id); all.push(s); } };
    for (const id of [...site.index.lights, ...site.index.climates, ...site.index.temps]) add(store.get(id) ?? { entity_id: id, attributes: {} });
    for (const s of storeAll()) add(s);
    return all;
  }
  const storeAll = () => store.all();

  function renderList() {
    const groups = KINDS.map((k) => ({ k, rows: [] }));
    for (const s of entities()) {
      const g = groups.find((x) => x.k.match(s));
      if (!g) continue;
      const name = nameOf(s.entity_id);
      const area = site.areas ? areaName(site.areas, areaOf(site.areas, s.entity_id)) : null;
      const auto = site.autoPlaced?.has(s.entity_id);
      if (filter && !`${name} ${s.entity_id} ${area ?? ''}`.toLowerCase().includes(filter)) continue;
      g.rows.push({ id: s.entity_id, name, area, auto, where: placementOf(s.entity_id) });
    }
    list.replaceChildren(...groups.filter((g) => g.rows.length).map(({ k, rows }) => {
      rows.sort((a, b) => (!!a.where - !!b.where) || a.name.localeCompare(b.name, site.locale));
      return el('section', {},
        el('h3', { class: 'eyebrow' }, `${t(k.label)} · ${rows.filter((r) => !r.where).length} ${t('editor.unplacedCount')}`),
        el('ul', {}, rows.map((r) => el('li', {},
          el('button', {
            type: 'button', class: `editor-ent${r.id === selected ? ' is-selected' : ''}${r.where ? '' : ' is-unplaced'}`,
            onclick: () => select(r.id),
          },
          el('span', { class: 'editor-ent-name' }, r.name),
          el('span', { class: 'editor-ent-where' }, r.where ?? (r.auto ? t('editor.autoIn', { area: r.area }) : r.area ? t('editor.unplacedIn', { area: r.area }) : t('editor.unplaced'))),
          el('span', { class: 'editor-ent-id' }, r.id))))));
    }));
    if (!list.children.length) list.append(el('p', { class: 'muted small' }, t('editor.noEntities')));
  }

  function select(id) {
    selected = id;
    const where = placementOf(id);
    selBox.replaceChildren(
      el('p', { class: 'small' }, el('strong', {}, nameOf(id)), ` · ${where ?? t('editor.unplaced')}`),
      where ? el('button', { class: 'chip', type: 'button', onclick: () => { unplace(id); save(t('editor.removed', { name: nameOf(id) })); } }, t('editor.remove')) : null);
    status.textContent = kindOf(id) === 'lights' ? t('editor.tapWhereLight') : t('editor.tapWhere');
    renderList();
  }

  function renderDraw() {
    out.textContent = points.length ? JSON.stringify(points) : '[]';
  }

  function copyText(text, done = t('editor.copied')) {
    navigator.clipboard?.writeText(text).then(() => { status.textContent = done; })
      .catch(() => {
        const ta = el('textarea', { class: 'editor-out', readonly: true }, text);
        status.replaceChildren(t('editor.copyManual'), ta);
        ta.select();
      });
  }
  function download() {
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(raw, null, 2) + '\n'], { type: 'application/json' })), download: 'site.json' });
    document.body.append(a); a.click(); a.remove();
  }
  function discard() {
    storage.set(draftKey(site.id), null);
    reload();
  }
  // In the Home Assistant panel the config can be written straight back (admins only).
  async function saveToHa() {
    status.textContent = t('editor.saving');
    try {
      await saveSite(raw);
      storage.set(draftKey(site.id), null);
      status.textContent = t('editor.saved');
      setTimeout(reload, 600);
    } catch (e) {
      status.textContent = t('editor.saveFailed', { msg: e.message });
    }
  }

  renderList();
  renderDraw();
  setMode('place');
  // Refresh the list when states arrive (for example after connecting to HA), at most once a second.
  let pending = null;
  store.watch(null, () => { if (!pending) pending = setTimeout(() => { pending = null; renderList(); }, 1000); });

  return {
    el: root,
    initialView: storage.get(viewKey),
    // Capture taps on an svg before the dashboard reacts to them.
    attach(svg, { label, round = 1, plan = null }) {
      svg.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        const p = svgPoint(svg, e);
        const at = [Math.round(p.x / round) * round, Math.round(p.y / round) * round];
        if (mode === 'draw') {
          if (drawTarget !== svg) { points = []; drawTarget = svg; }
          points.push(at);
          renderDraw();
          status.textContent = t('editor.where', { label });
          return;
        }
        if (!selected) { status.textContent = t('editor.pickFirst'); return; }
        if (plan) placeInPlan(plan, at);
        else placeOutdoor(at);
      }, true);
      for (const ev of ['pointerdown', 'pointerup', 'contextmenu']) svg.addEventListener(ev, (e) => e.stopPropagation(), true);
    },
  };
}
