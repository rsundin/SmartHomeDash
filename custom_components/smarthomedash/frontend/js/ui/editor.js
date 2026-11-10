// Placement mode, opened by adding #edit to the address.
//
// Place:  pick a light, switch, thermostat or temperature sensor from the list,
//         then tap where it is. On a floor plan the room is found from the tap
//         (point in polygon); on the overview a light becomes an outdoor lamp.
//         Tapping a lamp already on a picture selects it and shows its name tag.
// Draw:   click corners to get a polygon for site.json (rooms, buildings, panels).
//
// Changes are kept as a draft in this browser and applied by reloading the page.
// "Copy site.json" puts the result on the clipboard to paste into the real file.

import { el, sv, svgPoint, inside, storage } from '../util.js';
import { draftKey, missingFilterKey } from '../site.js';
import { t } from '../i18n.js';
import { areaOf, areaName } from '../areas.js';
import { nameOf as entityName } from '../entities.js';
import { configEntities, missingEntities } from '../status.js';

// Lights first, then temperature: what the dashboard is mostly for. Switches can be
// placed as lamps too, but most are not lamps (plugs, heaters, settings), so they get
// their own group, folded away until opened.
const KINDS = [
  { id: 'lights', label: 'editor.kindLights', match: (s) => s.entity_id.startsWith('light.') },
  { id: 'temperature', label: 'editor.kindTemp', match: (s) => s.entity_id.startsWith('sensor.') && (s.attributes?.device_class === 'temperature' || /°C|°F/.test(s.attributes?.unit_of_measurement || '')) },
  { id: 'climate', label: 'editor.kindClimate', match: (s) => s.entity_id.startsWith('climate.') },
  { id: 'switches', label: 'editor.kindSwitches', match: (s) => s.entity_id.startsWith('switch.'), folded: true },
];
// Switches are placed as lamps.
const placeKind = (kind) => (kind === 'switches' ? 'lights' : kind);

export function createEditor({ site, store, saveSite = null, reload = () => location.reload(), exit = null, update = null, reloadPage = () => location.reload() }) {
  const raw = site.raw;
  const viewKey = `shd:${site.id}:editview`;
  const selKey = `shd:${site.id}:editsel`;
  let mode = 'place';
  let selected = null;
  let filter = '';
  const unfolded = new Set(); // groups showing their less important entities too
  // Opened from the missing-devices warning: list only the devices Home Assistant does not know.
  let onlyMissing = !!storage.get(missingFilterKey(site.id));
  storage.set(missingFilterKey(site.id), null);
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

  // A device Home Assistant no longer knows: take it out of every list in site.json.
  // Energy, weather and doorbell settings are left for the setup guide or the file.
  function forget(id) {
    unplace(id);
    const drop = (list) => (Array.isArray(list) ? list.filter((x) => x !== id) : list);
    for (const plan of raw.floorplans ?? []) {
      for (const room of plan.rooms ?? []) if (room.sensors) room.sensors = drop(room.sensors);
    }
    for (const w of raw.overview?.windows ?? []) if (w.lights) w.lights = drop(w.lights);
    for (const b of raw.overview?.buildings ?? []) if (b.sensors) b.sensors = drop(b.sensors);
    if (raw.climates) {
      raw.climates = raw.climates.filter((c) => c.entity !== id);
      for (const c of raw.climates) if (c.temperature === id) delete c.temperature;
    }
    if (raw.scenes) raw.scenes = raw.scenes.filter((sc) => sc.entity !== id);
    if (raw.wall_screen?.idle?.wake) raw.wall_screen.idle.wake = drop(raw.wall_screen.idle.wake);
  }
  const missingNow = () => missingEntities(site, store);

  const nameOf = (id) => entityName(id, { store, site }, site.index.names.get(id) ?? id);
  const kindOf = (id) => placeKind(KINDS.find((k) => k.match(store.get(id) ?? { entity_id: id, attributes: {} }))?.id);

  function save(message) {
    storage.set(draftKey(site.id), raw);
    storage.set(viewKey, currentView());
    // Keep the selection and the message across the reload, so the moved lamp stays marked.
    storage.set(selKey, { id: selected, message });
    status.textContent = message;
    setTimeout(reload, 350);
  }
  const currentView = () => document.querySelector('.stage')?.dataset.view ?? null;

  // ---------- place on a floor plan
  function placeInPlan(plan, at, id = selected) {
    const kind = kindOf(id);
    const rawPlan = (raw.floorplans ?? []).find((p) => p.id === plan.id);
    const room = (rawPlan?.rooms ?? []).find((r) => inside(at, r.area));
    if (!room) { status.textContent = t('editor.outsideRooms'); return; }
    selected = id;
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
  // Name tag over the selected (or dragged) lamp on the picture.
  const tag = el('div', { class: 'lamp-tag', hidden: true, 'aria-hidden': 'true' });
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
    tabs, placePane, drawPane, status, draftRow, tag,
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

  // Less important, folded away under "Show n more" (search still finds them): a device's
  // own diagnostic or hidden entities, a switch, and a temperature sensor whose room
  // already shows another one, or that is in no room at all (a fridge, a router).
  const roomOfArea = (area) => [...site.index.rooms.values()].find((r) => r.ha_area === area && !r.device);
  function minor(s, kind) {
    const reg = site.areas?.entityReg?.get(s.entity_id);
    if (reg && (reg.entity_category || reg.hidden_by || reg.hidden)) return true;
    if (KINDS.find((k) => k.id === kind)?.folded) return true;
    if (kind === 'temperature') {
      const area = site.areas ? areaOf(site.areas, s.entity_id) : null;
      const room = area && roomOfArea(area);
      return !room || (room.temperature && room.temperature !== s.entity_id);
    }
    return false;
  }

  function renderList() {
    const missing = missingNow();
    const missingIds = new Set(missing.map((m) => m.id));
    const missingRows = missing.map((m) => ({ id: m.id, name: nameOf(m.id), where: m.where.join(', ') }))
      .filter((r) => !filter || `${r.name} ${r.id} ${r.where}`.toLowerCase().includes(filter));
    const missingSection = missingRows.length ? el('section', { class: 'editor-missing' },
      el('h3', { class: 'eyebrow' }, `${t('editor.missingGroup')} · ${missingRows.length}`),
      el('ul', {}, missingRows.map((r) => el('li', {},
        el('button', { type: 'button', class: `editor-ent is-missing${r.id === selected ? ' is-selected' : ''}`, onclick: () => select(r.id) },
          el('span', { class: 'editor-ent-name' }, r.name),
          el('span', { class: 'editor-ent-where' }, r.where),
          el('span', { class: 'editor-ent-id' }, r.id)))))) : null;
    if (onlyMissing) {
      list.replaceChildren(
        missingSection ?? el('p', { class: 'muted small' }, t('editor.missingNone')),
        el('button', { class: 'chip', type: 'button', onclick: () => { onlyMissing = false; renderList(); } }, t('editor.showAll')));
      return;
    }
    const groups = KINDS.map((k) => ({ k, rows: [] }));
    for (const s of entities()) {
      if (missingIds.has(s.entity_id)) continue;
      const g = groups.find((x) => x.k.match(s));
      if (!g) continue;
      const name = nameOf(s.entity_id);
      const area = site.areas ? areaName(site.areas, areaOf(site.areas, s.entity_id)) : null;
      const auto = site.autoPlaced?.has(s.entity_id);
      if (filter && !`${name} ${s.entity_id} ${area ?? ''}`.toLowerCase().includes(filter)) continue;
      const where = placementOf(s.entity_id);
      g.rows.push({ id: s.entity_id, name, area, auto, where, minor: !where && !auto && s.entity_id !== selected && minor(s, g.k.id) });
    }
    list.replaceChildren(...(missingSection ? [missingSection] : []), ...groups.filter((g) => g.rows.length).map(({ k, rows: all }) => {
      // Not placed first, then placed automatically, then placed.
      const rank = (r) => (r.where ? 2 : r.auto ? 1 : 0);
      all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, site.locale));
      const more = all.filter((r) => r.minor);
      const open = filter || unfolded.has(k.id);
      const rows = open ? all : all.filter((r) => !r.minor);
      const unplaced = all.filter((r) => !r.where && !r.auto && !r.minor).length;
      return el('section', { 'data-kind': k.id },
        el('h3', { class: 'eyebrow' }, unplaced ? `${t(k.label)} · ${unplaced} ${t('editor.unplacedCount')}` : t(k.label)),
        more.length && !filter ? el('button', {
          class: 'chip editor-more', type: 'button', 'aria-expanded': String(!!open),
          onclick: () => { if (open) unfolded.delete(k.id); else unfolded.add(k.id); renderList(); },
        }, t(open ? 'editor.showFewer' : 'editor.showMore', { n: more.length })) : null,
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
    const gone = missingNow().find((m) => m.id === id);
    if (gone) {
      selBox.replaceChildren(
        el('p', { class: 'small' }, el('strong', {}, nameOf(id)), ` · ${t('editor.missingSel')}`,
          el('span', { class: 'editor-sel-id' }, id)),
        el('button', { class: 'chip', type: 'button', onclick: () => removeMissing(id) }, t('editor.missingRemove')));
      status.textContent = t('editor.missingHelp', { where: gone.where.join(', ') });
      renderList();
      return;
    }
    const where = placementOf(id);
    selBox.replaceChildren(
      el('p', { class: 'small' }, el('strong', {}, nameOf(id)), ` · ${where ?? t('editor.unplaced')}`,
        el('span', { class: 'editor-sel-id' }, id)),
      where ? el('button', { class: 'chip', type: 'button', onclick: () => { unplace(id); save(t('editor.removed', { name: nameOf(id) })); } }, t('editor.remove')) : null);
    status.textContent = kindOf(id) === 'lights' ? t('editor.tapWhereLight') : t('editor.tapWhere');
    renderList();
    list.querySelector('.is-selected')?.scrollIntoView?.({ block: 'nearest' });
  }

  function removeMissing(id) {
    forget(id);
    const left = configEntities(raw).find((e) => e.id === id);
    selected = null;
    if (onlyMissing) storage.set(missingFilterKey(site.id), true);
    save(left ? t('editor.missingLeft', { name: nameOf(id), where: left.where.join(', ') }) : t('editor.removed', { name: nameOf(id) }));
  }

  // A tap on a lamp already on a picture selects it instead of placing something there.
  function pick(node) {
    let id = node.dataset.entity;
    if (node.dataset.drag === 'lamp') id = (raw.overview?.zones ?? []).find((z) => z.id === node.dataset.zone)?.lights?.[0];
    if (!id) return;
    select(id);
    status.textContent = t('editor.picked', { name: nameOf(id) });
  }

  // ---------- name tag
  // Follows the lamp on screen (zoom, scroll, drag) while placement mode is open.
  let dragNode = null;
  let tagFor = null;
  function lampNode(id) {
    const zones = (raw.overview?.zones ?? []).filter((z) => (z.lights ?? []).includes(id)).map((z) => z.id);
    const nodes = [...document.querySelectorAll('[data-drag]')].filter((n) =>
      n.dataset.drag === 'light' ? n.dataset.entity === id : zones.includes(n.dataset.zone));
    return nodes.find((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) ?? null;
  }
  function placeTag() {
    if (!root.isConnected) return;
    requestAnimationFrame(placeTag);
    const node = mode === 'place' ? (dragNode ?? (selected ? lampNode(selected) : null)) : null;
    const id = !node ? null : dragNode
      ? (node.dataset.entity ?? (raw.overview?.zones ?? []).find((z) => z.id === node.dataset.zone)?.lights?.[0])
      : selected;
    if (!node || !id) {
      if (!tag.hidden) document.querySelectorAll('.is-picked').forEach((n) => n.classList.remove('is-picked'));
      tag.hidden = true; tagFor = null; return;
    }
    if (tagFor !== id) {
      tagFor = id;
      tag.replaceChildren(el('strong', {}, nameOf(id)), el('span', {}, id));
    }
    tag.hidden = false;
    node.classList.add('is-picked');
    document.querySelectorAll('.is-picked').forEach((n) => { if (n !== node) n.classList.remove('is-picked'); });
    const r = node.getBoundingClientRect();
    const w = tag.offsetWidth, h = tag.offsetHeight;
    const x = Math.min(Math.max(r.left + r.width / 2 - w / 2, 8), innerWidth - w - 8);
    const above = r.top - h - 8;
    const y = above > 8 ? above : r.bottom + 8;
    tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
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
  const resumed = storage.get(selKey);
  storage.set(selKey, null);
  if (resumed?.id) {
    select(resumed.id);
    if (resumed.message) status.textContent = resumed.message;
  }
  requestAnimationFrame(placeTag);
  // Refresh the list when states arrive (for example after connecting to HA), at most once a second.
  let pending = null;
  store.watch(null, () => { if (!pending) pending = setTimeout(() => { pending = null; renderList(); }, 1000); });

  // ---------- drag a lamp to move it
  // On a floor plan a lamp can be dropped in another room; on the overview picture one
  // fixture of an outdoor lamp moves. A press without moving stays a tap.
  let dragged = false;
  let tapped = null;
  function enableDrag(svg, { round, plan }) {
    let drag = null;
    const snap = (p) => [Math.round(p.x / round) * round, Math.round(p.y / round) * round];
    svg.addEventListener('pointerdown', (e) => {
      if (mode !== 'place' || e.button > 0) return;
      const node = e.target.closest?.('[data-drag]');
      if (!node) return;
      const p = svgPoint(svg, e);
      drag = { node, id: e.pointerId, from: [e.clientX, e.clientY], start: [p.x, p.y], moved: false, ghost: null };
      svg.setPointerCapture?.(e.pointerId);
    }, true);
    svg.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.from[0], e.clientY - drag.from[1]) < 6) return;
      e.preventDefault();
      const p = svgPoint(svg, e);
      if (!drag.moved) {
        drag.moved = true;
        drag.node.classList.add('is-dragging');
        dragNode = drag.node;
        const r = Number(drag.node.querySelector?.('.fp-lamp-hit')?.getAttribute('r') ?? drag.node.getAttribute('r') ?? 12);
        drag.ghost = sv('circle', { class: 'drag-ghost', r: Math.max(r * 0.8, 6) });
        svg.append(drag.ghost);
      }
      drag.ghost.setAttribute('cx', p.x);
      drag.ghost.setAttribute('cy', p.y);
      const [dx, dy] = [p.x - drag.start[0], p.y - drag.start[1]];
      drag.node.setAttribute('transform', `translate(${dx} ${dy})`);
    }, true);
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      dragNode = null;
      if (!d.moved) {
        // Pointer capture makes the svg the click target, so remember which lamp was tapped.
        tapped = d.node;
        setTimeout(() => { tapped = null; }, 0);
        return;
      }
      dragged = true; // the click that follows is not a placement
      setTimeout(() => { dragged = false; }, 0);
      d.ghost?.remove();
      const at = snap(svgPoint(svg, e));
      if (d.node.dataset.drag === 'light' && plan) {
        placeInPlan(plan, at, d.node.dataset.entity);
      } else if (d.node.dataset.drag === 'lamp') {
        const zone = (raw.overview?.zones ?? []).find((z) => z.id === d.node.dataset.zone);
        const lamp = zone?.lamps?.[Number(d.node.dataset.lamp)];
        if (!lamp) { d.node.removeAttribute('transform'); return; }
        lamp.at = at;
        selected = zone.lights?.[0] ?? selected;
        save(t('editor.moved', { name: zone.name }));
      }
    };
    svg.addEventListener('pointerup', end, true);
    svg.addEventListener('pointercancel', (e) => { dragNode = null; if (drag?.node) { drag.node.removeAttribute('transform'); drag.ghost?.remove(); } drag = null; }, true);
  }

  return {
    el: root,
    initialView: storage.get(viewKey),
    // Capture taps on an svg before the dashboard reacts to them.
    attach(svg, { label, round = 1, plan = null }) {
      svg.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        if (dragged) return;
        const p = svgPoint(svg, e);
        const at = [Math.round(p.x / round) * round, Math.round(p.y / round) * round];
        if (mode === 'draw') {
          if (drawTarget !== svg) { points = []; drawTarget = svg; }
          points.push(at);
          renderDraw();
          status.textContent = t('editor.where', { label });
          return;
        }
        const lampHit = tapped ?? e.target.closest?.('[data-drag]');
        if (lampHit) { pick(lampHit); return; }
        if (!selected) { status.textContent = t('editor.pickFirst'); return; }
        if (plan) placeInPlan(plan, at);
        else placeOutdoor(at);
      }, true);
      for (const ev of ['pointerdown', 'pointerup', 'contextmenu']) svg.addEventListener(ev, (e) => e.stopPropagation(), true);
      enableDrag(svg, { round, plan });
    },
  };
}
