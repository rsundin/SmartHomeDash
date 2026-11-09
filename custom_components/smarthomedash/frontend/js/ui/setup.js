// Setup guide: everything a new site needs, without editing site.json by hand.
//
//   Basics      name, language, currency
//   Overview    day and evening picture, buildings, solar panels, windows
//   Floor plans a picture per floor plan, rooms drawn on it
//   Energy      power, energy, price and weather entities
//   Buttons     scenes and scripts shown as buttons
//   Lights      hands over to placement mode
//
// Works on a copy of the config; "Save" writes it to Home Assistant and restarts
// the dashboard, "Close" throws the changes away. Pictures are uploaded at once.

import { el, sv, pts, svgPoint, centroid } from '../util.js';
import { t } from '../i18n.js';
import { noAreas, areaName, floorName, fillRoomFromArea, matchRoomsByName } from '../areas.js';

const STEPS = ['basics', 'overview', 'plans', 'energy', 'buttons', 'lights'];

// Prompts for making the overview pictures from a map screenshot with an image model.
// English on purpose: image models follow it most consistently. Kept in step with
// docs/overview-picture.md.
const PROMPT_DAY = `Turn this screenshot from a 3D map into a photorealistic drone photograph of the same property. Keep the exact camera angle, framing and aspect ratio. Keep every building, roof shape, window, door, solar panel, driveway, tree and fence where it is and in its real proportions; do not add or remove buildings.
Clean up map artefacts: melted or blurry geometry, smeared trees, flat textures, labels, icons, cars and people.
Light: bright overcast midday, soft even daylight, gentle shadows, natural colours.
Make building outlines, roof edges, windows and solar panels crisp and clearly visible.
All lights are OFF: no lit windows, no outdoor lamps.
No text, no watermark, no people, no vehicles.`;
const PROMPT_NIGHT = `Edit this exact image. Keep the camera angle, framing, image size and every building, roof, window, solar panel, tree and path exactly where they are; change nothing but the light. Change the time of day to blue hour shortly after sunset: deep blue sky glow, cool ambient light, soft shadows, buildings still clearly readable.
All lights are OFF: no lit windows, no outdoor lamps, no glow anywhere.
Photorealistic. No text, no people.`;
const GUIDE_URL = 'https://github.com/rsundin/SmartHomeDash/blob/main/docs/overview-picture.md';

export function createSetup({ site, store, saveSite, uploadFile, reload, openPlacement, onClose = () => {} }) {
  const cfg = structuredClone(site.raw);
  cfg.floorplans ??= [];
  cfg.energy ??= {};
  cfg.scenes ??= [];
  const previews = new Map(); // path -> object URL for pictures uploaded in this session
  const picture = (path) => previews.get(path) ?? site.asset(path);
  const areas = site.areas ?? noAreas();
  let step = STEPS[0];
  let dirty = false;

  const nav = el('nav', { class: 'setup-nav', 'aria-label': t('setup.title') });
  const body = el('div', { class: 'setup-body' });
  const status = el('p', { class: 'small setup-status', role: 'status' });
  const saveBtn = el('button', { class: 'chip chip-primary', type: 'button', onclick: save }, t('setup.save'));
  const root = el('div', { class: 'setup', role: 'dialog', 'aria-label': t('setup.title') },
    el('header', { class: 'setup-head' },
      el('div', {}, el('p', { class: 'eyebrow' }, t('setup.eyebrow')), el('h2', { class: 'panel-title' }, t('setup.title'))),
      el('div', { class: 'row' }, status, saveBtn,
        el('button', { class: 'chip', type: 'button', onclick: close }, t('setup.close')))),
    el('div', { class: 'setup-main' }, nav, body));

  const changed = () => { dirty = true; status.textContent = t('setup.unsaved'); };

  async function save() {
    delete cfg.setup_pending;
    saveBtn.disabled = true;
    status.textContent = t('editor.saving');
    try {
      await saveSite(cfg);
      dirty = false;
      status.textContent = t('editor.saved');
      setTimeout(reload, 500);
    } catch (e) {
      status.textContent = t('editor.saveFailed', { msg: e.message });
      saveBtn.disabled = false;
    }
  }
  // With unsaved changes, Close asks what to do with clear buttons instead of closing.
  function close() {
    if (!dirty) { root.remove(); onClose(); return; }
    status.replaceChildren(
      el('span', {}, t('setup.closeConfirm')), ' ',
      el('button', { class: 'chip chip-danger', type: 'button', onclick: () => { root.remove(); onClose(); } }, t('setup.discard')), ' ',
      el('button', { class: 'chip chip-primary', type: 'button', onclick: save }, t('setup.save')));
  }

  function render() {
    // Without an overview picture (an apartment) that step is optional and comes after the plans.
    const steps = cfg.overview ? STEPS : ['basics', 'plans', 'overview', 'energy', 'buttons', 'lights'];
    nav.replaceChildren(...steps.map((s, i) => el('button', {
      type: 'button', class: `setup-step${s === step ? ' is-active' : ''}`, 'aria-current': String(s === step),
      onclick: () => { step = s; render(); },
    }, el('span', { class: 'setup-num' }, String(i + 1)), t(s === 'overview' && !cfg.overview ? 'setup.step.overviewOptional' : `setup.step.${s}`))));
    body.replaceChildren(...{ basics, overview, plans, energy, buttons, lights }[step]());
    body.scrollTop = 0;
  }

  // ---------- helpers
  const field = (label, control, help) => el('label', { class: 'setup-field' },
    el('span', { class: 'setup-label' }, label), control, help ? el('span', { class: 'muted small' }, help) : null);
  const section = (title, ...kids) => el('section', { class: 'setup-section' }, el('h3', { class: 'eyebrow' }, title), ...kids);
  const intro = (key) => el('p', { class: 'setup-intro' }, t(key));
  // Pictures shipped with the integration are named example_*; flag them until replaced.
  const isExample = (path) => typeof path === 'string' && path.startsWith('example_');
  const exampleNote = (key) => el('p', { class: 'setup-note' }, t(key));
  const input = (value, onInput, attrs = {}) => {
    const n = el('input', { class: 'setup-input', value: value ?? '', ...attrs });
    n.addEventListener('input', () => { onInput(n.value); changed(); });
    return n;
  };
  const select = (options, value, onChange, attrs = {}) => {
    const n = el('select', { class: 'setup-input', ...attrs },
      options.map(([v, label]) => el('option', { value: v, selected: v === (value ?? '') }, label)));
    n.addEventListener('change', () => { changed(); onChange(n.value); });
    return n;
  };
  const fileButton = (label, onFile) => {
    const inp = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
    inp.addEventListener('change', () => { if (inp.files[0]) onFile(inp.files[0]); inp.value = ''; });
    return el('span', {}, inp, el('button', { class: 'chip', type: 'button', onclick: () => inp.click() }, label));
  };
  const ext = (file) => ({ 'image/png': 'png', 'image/webp': 'webp' }[file.type] ?? 'jpg');
  const imageSize = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
    img.onerror = () => reject(new Error(t('setup.notAPicture')));
    img.src = URL.createObjectURL(file);
  });
  async function upload(file, name) {
    status.textContent = t('setup.uploading');
    await uploadFile(name, file);
    previews.set(name, URL.createObjectURL(file));
    status.textContent = t('setup.uploaded');
    changed();
  }
  const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item';
  const uniqueId = (base, taken) => { let id = base, i = 2; while (taken.includes(id)) id = `${base}_${i++}`; return id; };
  const entityOptions = (filter) => [['', t('setup.none')], ...store.all()
    .filter(filter)
    .map((s) => [s.entity_id, `${s.attributes?.friendly_name ?? s.entity_id} · ${s.entity_id}`])
    .sort((a, b) => a[1].localeCompare(b[1], site.locale))];
  const rooms = () => cfg.floorplans.flatMap((p) => (p.rooms ?? []).map((r) => [r.id, `${r.name} (${p.name})`]));

  // ---------- 1. basics
  function basics() {
    return [
      site.raw.setup_pending ? exampleNote(cfg.overview ? 'setup.welcome' : 'setup.welcomeApartment') : null,
      intro('setup.basicsIntro'),
      section(t('setup.step.basics'),
        field(t('setup.name'), input(cfg.name, (v) => { cfg.name = v; })),
        field(t('setup.language'), select([['sv', 'Svenska'], ['en', 'English']], cfg.language ?? 'sv', (v) => {
          cfg.language = v; cfg.locale = v === 'sv' ? 'sv-SE' : 'en-GB';
        }), t('setup.languageHelp')),
        field(t('setup.currency'), input(cfg.currency ?? 'SEK', (v) => { cfg.currency = v.toUpperCase(); }, { maxlength: 3 }))),
    ];
  }

  // ---------- 2. overview
  function overview() {
    const ov = cfg.overview;
    const out = [intro(ov ? 'setup.overviewIntro' : 'setup.overviewIntroApartment')];
    if (isExample(ov?.image)) out.push(exampleNote('setup.exampleOverview'));
    out.push(section(t('setup.pictures'),
      el('div', { class: 'setup-pics' },
        pictureSlot(t('setup.dayPicture'), ov?.image, async (file) => {
          const size = await imageSize(file);
          const name = `overview.${ext(file)}`;
          const wasExample = isExample(cfg.overview?.image);
          await upload(file, name);
          cfg.overview = { buildings: [], zones: [], windows: [], ...(cfg.overview ?? {}), image: name, size };
          if (wasExample) {
            // The example's shapes belong to the example picture.
            Object.assign(cfg.overview, { buildings: [], zones: [], windows: [] });
            delete cfg.overview.energy_points;
            delete cfg.overview.solar;
            delete cfg.overview.night_image;
          }
          if (cfg.overview.night_image) status.textContent = t('setup.checkNight');
          render();
        }, null),
        ov?.image ? pictureSlot(t('setup.nightPicture'), ov.night_image, async (file) => {
          const size = await imageSize(file);
          if (size[0] !== ov.size[0] || size[1] !== ov.size[1]) {
            status.textContent = t('setup.nightSizeMismatch', { w: ov.size[0], h: ov.size[1], w2: size[0], h2: size[1] });
            return;
          }
          const name = `overview_night.${ext(file)}`;
          await upload(file, name);
          ov.night_image = name;
          render();
        }, ov.night_image ? () => { delete ov.night_image; changed(); render(); } : null, t('setup.nightHelp')) : null)));
    out.push(noDroneGuide(!ov?.image || isExample(ov.image)));
    if (!ov?.image) return out;
    out.push(section(t('setup.removeOverview'), el('p', { class: 'muted small' }, t('setup.removeOverviewHelp')),
      el('button', { class: 'chip chip-danger', type: 'button', onclick: () => { delete cfg.overview; changed(); step = 'plans'; render(); } }, t('setup.removeOverview'))));

    // buildings
    const bList = el('ul', { class: 'setup-list setup-rooms' }, (ov.buildings ?? []).map((b, i) => el('li', {},
      areas.list.length ? select([['', t('setup.noArea')], ...freeAreas(b.ha_area)], b.ha_area, (v) => {
        if (v) { b.ha_area = v; b.name = areaName(areas, v); } else delete b.ha_area;
        render();
      }, { 'aria-label': t('setup.area') }) : null,
      b.ha_area && areaName(areas, b.ha_area)
        ? el('span', { class: 'setup-room-name' }, areaName(areas, b.ha_area))
        : input(b.name, (v) => { b.name = v; }, { 'aria-label': t('setup.name') }),
      select([['', t('setup.noPlan')], ...cfg.floorplans.map((p) => [p.id, p.name])], b.floorplan, (v) => { if (v) b.floorplan = v; else delete b.floorplan; }, { 'aria-label': t('setup.floorPlan') }),
      el('button', { class: 'chip chip-danger', type: 'button', onclick: () => { ov.buildings.splice(i, 1); changed(); render(); } }, t('setup.remove')))));
    out.push(section(t('setup.buildings'), el('p', { class: 'muted small' }, t('setup.buildingsHelp')), bList,
      drawButton(t('setup.drawBuilding'), { src: picture(ov.image), size: ov.size, shapes: overviewShapes(), pick: areaPick() }, (poly, areaId) => {
        ov.buildings ??= [];
        const name = (areaId && areaName(areas, areaId)) || t('setup.building', { n: ov.buildings.length + 1 });
        ov.buildings.push({ id: uniqueId(slug(name), ov.buildings.map((b) => b.id)), name, area: poly, ...(areaId ? { ha_area: areaId } : {}) });
      })));

    // solar panels
    ov.solar ??= null;
    const solar = ov.solar;
    out.push(section(t('setup.solar'), el('p', { class: 'muted small' }, t('setup.solarHelp')),
      solar ? el('div', { class: 'setup-row' },
        field(t('setup.peakKw'), input(solar.peak_kw ?? 5, (v) => { solar.peak_kw = parseFloat(v) || 5; }, { type: 'number', step: '0.1', min: '0.5' })),
        el('span', { class: 'muted small' }, t('setup.panelCount', { n: solar.panels.length })),
        el('button', { class: 'chip chip-danger', type: 'button', onclick: () => { delete ov.solar; changed(); render(); } }, t('setup.removeAll'))) : null,
      drawButton(t('setup.drawPanel'), { src: picture(ov.image), size: ov.size, shapes: overviewShapes() }, (poly) => {
        ov.solar ??= { peak_kw: 5, panels: [] };
        ov.solar.panels.push(poly);
      })));

    // windows
    const wList = el('ul', { class: 'setup-list' }, (ov.windows ?? []).map((w, i) => el('li', {},
      el('span', {}, t('setup.window', { n: i + 1 })),
      select([['', t('setup.pickRoom')], ...rooms()], w.room, (v) => { w.room = v; }, { 'aria-label': t('setup.room') }),
      el('button', { class: 'chip chip-danger', type: 'button', onclick: () => { ov.windows.splice(i, 1); changed(); render(); } }, t('setup.remove')))));
    out.push(section(t('setup.windows'), el('p', { class: 'muted small' }, t(rooms().length ? 'setup.windowsHelp' : 'setup.windowsNeedRooms')), wList,
      rooms().length ? drawButton(t('setup.drawWindow'), { src: picture(ov.image), size: ov.size, shapes: overviewShapes() }, (poly) => {
        ov.windows ??= [];
        ov.windows.push({ room: rooms()[0][0], area: poly });
      }) : null));
    out.push(energyPoints(ov));
    out.push(el('p', { class: 'muted small' }, t('setup.outdoorLightsHint')));
    return out;
  }

  // Where the energy flow on the picture starts and ends: tap one spot for each.
  function energyPoints(ov) {
    const kinds = [['house', 'setup.pointHouse'], ['grid', 'setup.pointGrid'], ['battery', 'setup.pointBattery'], ['charger', 'setup.pointCharger']];
    const list = el('ul', { class: 'setup-list' }, kinds.map(([key, label]) => el('li', {},
      el('span', {}, t(label)),
      el('span', { class: 'muted small' }, ov.energy_points?.[key] ? t('setup.pointSet') : t('setup.pointAuto')),
      drawButton(t(ov.energy_points?.[key] ? 'setup.pointMove' : 'setup.pointPlace'), { src: picture(ov.image), size: ov.size, shapes: overviewShapes(), point: true }, ([pt]) => {
        ov.energy_points ??= {};
        ov.energy_points[key] = pt;
      }),
      ov.energy_points?.[key] ? el('button', { class: 'chip chip-danger', type: 'button', onclick: () => { delete ov.energy_points[key]; changed(); render(); } }, t('setup.remove')) : null)));
    return section(t('setup.energyFlow'), el('p', { class: 'muted small' }, t('setup.energyFlowHelp')), list);
  }

  // No drone: make the pictures from a 3D map screenshot and an image model.
  function noDroneGuide(open) {
    const prompt = (title, text) => {
      const copy = el('button', { class: 'chip', type: 'button' }, t('editor.copy'));
      copy.addEventListener('click', () => navigator.clipboard?.writeText(text)
        .then(() => { status.textContent = t('editor.copied'); })
        .catch(() => { status.textContent = t('setup.copyManual'); }));
      return el('div', { class: 'setup-prompt' },
        el('div', { class: 'row-between' }, el('strong', {}, title), copy),
        el('pre', {}, text));
    };
    return el('details', { class: 'setup-section setup-guide', open },
      el('summary', { class: 'eyebrow' }, t('setup.noDrone')),
      el('p', { class: 'muted small' }, t('setup.noDroneIntro')),
      el('ol', { class: 'setup-steps' },
        el('li', {}, t('setup.noDrone1')),
        el('li', {}, t('setup.noDrone2')),
        el('li', {}, t('setup.noDrone3')),
        el('li', {}, t('setup.noDrone4')),
        el('li', {}, t('setup.noDrone5'))),
      prompt(t('setup.promptDay'), PROMPT_DAY),
      prompt(t('setup.promptNight'), PROMPT_NIGHT),
      el('p', { class: 'muted small' }, t('setup.noDroneNote'), ' ',
        el('a', { href: GUIDE_URL, target: '_blank', rel: 'noopener' }, t('setup.noDroneMore'))));
  }

  function overviewShapes() {
    const ov = cfg.overview;
    return [
      ...(ov.buildings ?? []).map((b) => ({ points: b.area, label: b.name, kind: 'building' })),
      ...(ov.solar?.panels ?? []).map((p) => ({ points: p, kind: 'solar' })),
      ...(ov.windows ?? []).map((w) => ({ points: w.area, kind: 'window' })),
    ];
  }

  function pictureSlot(label, path, onFile, onRemove, help) {
    return el('div', { class: 'setup-pic' },
      el('span', { class: 'setup-label' }, label),
      path ? el('img', { src: picture(path), alt: label }) : el('div', { class: 'setup-pic-empty' }, t('setup.noPicture')),
      el('div', { class: 'row' },
        fileButton(path ? t('setup.replace') : t('setup.upload'), (f) => onFile(f).catch((e) => { status.textContent = e.message; })),
        onRemove ? el('button', { class: 'chip chip-danger', type: 'button', onclick: onRemove }, t('setup.remove')) : null),
      help ? el('span', { class: 'muted small' }, help) : null);
  }

  // ---------- 3. floor plans
  function plans() {
    const out = [intro('setup.plansIntro')];
    if (cfg.floorplans.some((p) => isExample(p.image?.src ?? p.image))) out.push(exampleNote('setup.examplePlans'));
    for (const [pi, plan] of cfg.floorplans.entries()) {
      const src = plan.image ? picture(typeof plan.image === 'string' ? plan.image : plan.image.src) : null;
      const size = plan.image?.bounds ? [plan.image.bounds[2], plan.image.bounds[3]] : null;
      const roomList = el('ul', { class: 'setup-list setup-rooms' }, (plan.rooms ?? []).map((r, i) => el('li', {},
        areas.list.length ? areaSelect(r) : null,
        r.ha_area && areaName(areas, r.ha_area)
          ? el('span', { class: 'setup-room-name' }, areaName(areas, r.ha_area))
          : input(r.name, (v) => { r.name = v; }, { 'aria-label': t('setup.name') }),
        el('span', { class: 'muted small' }, roomSummary(r)),
        r.ha_area ? el('button', { class: 'chip', type: 'button', onclick: () => fill(r) }, t('setup.fetchFromArea')) : null,
        el('button', { class: 'chip chip-danger', type: 'button', onclick: () => { plan.rooms.splice(i, 1); changed(); render(); } }, t('setup.remove')))));
      out.push(section(plan.name,
        el('div', { class: 'setup-row' },
          plan.ha_floor && floorName(areas, plan.ha_floor)
            ? field(t('setup.name'), el('span', { class: 'setup-room-name' }, floorName(areas, plan.ha_floor)))
            : field(t('setup.name'), input(plan.name, (v) => { plan.name = v; })),
          areas.floors?.length ? field(t('setup.floor'), select(
            [['', t('setup.noFloor')], ...areas.floors.map((f) => [f.floor_id, f.name])],
            plan.ha_floor,
            (v) => { if (v) { plan.ha_floor = v; plan.name = floorName(areas, v); } else delete plan.ha_floor; render(); },
            { 'aria-label': t('setup.floor') })) : null,
          el('button', { class: 'chip chip-danger', type: 'button', onclick: () => {
            cfg.floorplans.splice(pi, 1);
            for (const b of cfg.overview?.buildings ?? []) if (b.floorplan === plan.id) delete b.floorplan;
            changed(); render();
          } }, t('setup.removePlan'))),
        src ? el('img', { class: 'setup-plan-thumb', src, alt: plan.name }) : el('p', { class: 'muted small' }, t('setup.planNoPicture')),
        el('h4', { class: 'setup-label' }, t('setup.rooms')),
        areas.list.length ? el('p', { class: 'muted small' }, t('setup.areasHelp')) : null,
        roomList,
        src && size ? drawButton(t('setup.drawRoom'), { src, size, pick: areaPick(), shapes: (plan.rooms ?? []).map((r) => ({ points: r.area, label: r.name, kind: 'room' })) }, (poly, areaId) => {
          plan.rooms ??= [];
          const name = (areaId && areaName(areas, areaId)) || t('setup.room') + ` ${plan.rooms.length + 1}`;
          const room = { id: uniqueId(slug(name), cfg.floorplans.flatMap((p) => (p.rooms ?? []).map((r) => r.id))), name, area: poly, lights: [] };
          plan.rooms.push(room);
          if (areaId) { room.ha_area = areaId; status.textContent = t('setup.fetched', { n: fillRoomFromArea(cfg, room, areas, store), room: name }); }
        }) : null));
    }
    const unlinked = cfg.floorplans.flatMap((p) => p.rooms ?? []).filter((r) => !r.ha_area);
    const unlinkedPlans = areas.floors?.length ? cfg.floorplans.filter((p) => !p.ha_floor) : [];
    if (areas.list.length && (unlinked.length || unlinkedPlans.length)) {
      out.splice(1, 0, section(t('setup.areas'), el('p', { class: 'muted small' }, t('setup.matchAreasHelp')),
        el('button', { class: 'chip', type: 'button', onclick: () => {
          const linkedBuildings = () => (cfg.overview?.buildings ?? []).filter((b) => b.ha_area).length;
          const buildingsBefore = linkedBuildings();
          const plansBefore = cfg.floorplans.filter((p) => p.ha_floor).length;
          const matched = matchRoomsByName(cfg, areas);
          const plans = cfg.floorplans.filter((p) => p.ha_floor).length - plansBefore;
          const n = matched.reduce((sum, r) => sum + fillRoomFromArea(cfg, r, areas, store), 0);
          const buildings = linkedBuildings() - buildingsBefore;
          if (matched.length || plans || buildings) changed();
          render();
          status.textContent = matched.length || plans || buildings
            ? t('setup.matchedAreas', { rooms: matched.length, n }) + (plans ? ` ${t('setup.matchedFloors', { plans })}` : '') + (buildings ? ` ${t('setup.matchedBuildings', { buildings })}` : '')
            : t('setup.noAreaMatch');
        } }, t('setup.matchAreas'))));
    }
    out.push(section(t('setup.addPlan'), el('p', { class: 'muted small' }, t('setup.addPlanHelp')),
      fileButton(t('setup.uploadPlan'), async (file) => {
        try {
          const size = await imageSize(file);
          const name = t('setup.floorPlan') + (cfg.floorplans.length ? ` ${cfg.floorplans.length + 1}` : '');
          const id = uniqueId(slug(name), cfg.floorplans.map((p) => p.id));
          const path = `plan_${id}.${ext(file)}`;
          await upload(file, path);
          cfg.floorplans.push({
            id, name, unit: 'px',
            image: { src: path, bounds: [0, 0, size[0], size[1]] },
            outline: [[0, 0], [size[0], 0], [size[0], size[1]], [0, size[1]]],
            rooms: [],
          });
          const lone = (cfg.overview?.buildings ?? []).filter((b) => !b.floorplan);
          if (lone.length === 1) lone[0].floorplan = id;
          render();
        } catch (e) { status.textContent = e.message; }
      })));
    return out;
  }

  // Areas still free: not linked to a room or a building yet (plus the one given).
  function freeAreas(keep) {
    const used = new Set([
      ...cfg.floorplans.flatMap((p) => (p.rooms ?? []).map((r) => r.ha_area)),
      ...(cfg.overview?.buildings ?? []).map((b) => b.ha_area),
    ].filter((id) => id && id !== keep));
    return areas.list.filter((a) => !used.has(a.area_id)).map((a) => [a.area_id, a.name]).sort((a, b) => a[1].localeCompare(b[1], site.locale));
  }
  const areaPick = () => (areas.list.length ? { label: t('setup.area'), options: [['', t('setup.noArea')], ...freeAreas()] } : null);

  // A room linked to a Home Assistant area takes the area's name, lights and thermostat.
  function areaSelect(room) {
    const options = [['', t('setup.noArea')], ...freeAreas(room.ha_area)];
    return select(options, room.ha_area, (v) => {
      if (v) {
        room.ha_area = v;
        room.name = areaName(areas, v);
        const n = fillRoomFromArea(cfg, room, areas, store);
        status.textContent = t('setup.fetched', { n, room: room.name });
      } else {
        delete room.ha_area;
      }
      render();
    }, { 'aria-label': t('setup.area') });
  }
  function fill(room) {
    const n = fillRoomFromArea(cfg, room, areas, store);
    if (n) changed();
    render();
    status.textContent = t('setup.fetched', { n, room: room.name });
  }
  const roomSummary = (r) => [
    r.lights?.length ? `${r.lights.length} ${t('setup.lightsShort')}` : '',
    r.climate ? t('setup.thermostatShort') : '',
    r.temperature ? t('setup.sensorShort') : '',
  ].filter(Boolean).join(' · ');

  // ---------- 4. energy
  function energy() {
    const E = cfg.energy;
    const unit = (s) => (s.attributes?.unit_of_measurement || '').toLowerCase();
    const dc = (s) => s.attributes?.device_class;
    const isSensor = (s) => s.entity_id.startsWith('sensor.');
    const power = (s) => isSensor(s) && (dc(s) === 'power' || ['w', 'kw'].includes(unit(s)));
    const energyKwh = (s) => isSensor(s) && (dc(s) === 'energy' || ['kwh', 'wh'].includes(unit(s)));
    const battery = (s) => isSensor(s) && (dc(s) === 'battery' || (unit(s) === '%' && /batt|soc/i.test(s.entity_id)));
    const money = (s) => isSensor(s) && (dc(s) === 'monetary' || unit(s) === (cfg.currency || '').toLowerCase());
    const price = (s) => isSensor(s) && (Array.isArray(s.attributes?.today) || Array.isArray(s.attributes?.raw_today) || Array.isArray(s.attributes?.prices_today) || /\/kwh/.test(unit(s)));
    const row = (key, label, filter) => field(label, select(entityOptions(filter), E[key], (v) => { if (v) E[key] = v; else delete E[key]; }));
    E.price ??= {};
    return [
      intro('setup.energyIntro'),
      section(t('setup.energyNow'),
        row('load_power', t('cards.load'), power),
        row('grid_power', t('cards.grid'), power),
        row('pv_power', t('cards.solar'), power),
        row('battery_power', t('cards.battery'), power),
        row('battery_soc', t('setup.batteryLevel'), battery),
        row('charger_power', t('cards.charger'), power)),
      section(t('setup.energyToday'),
        row('energy_today', t('cards.usedToday'), energyKwh),
        row('pv_energy_today', t('cards.solarToday'), energyKwh),
        row('cost_today', t('cards.costToday'), money),
        row('savings_today', t('cards.savingsToday'), money)),
      section(t('setup.priceWeather'),
        field(t('cards.priceToday'), select(entityOptions(price), E.price.entity, (v) => {
          if (v) {
            const a = store.get(v)?.attributes ?? {};
            E.price = { entity: v, today_attribute: Array.isArray(a.today) ? 'today' : Array.isArray(a.raw_today) ? 'raw_today' : 'prices_today' };
          } else delete E.price;
        }), t('setup.priceHelp')),
        field(t('setup.weather'), select(entityOptions((s) => s.entity_id.startsWith('weather.')), cfg.weather, (v) => { if (v) cfg.weather = v; else delete cfg.weather; }))),
      section(t('setup.heatDevices'), el('p', { class: 'muted small' }, t('setup.heatDevicesHelp')),
        el('ul', { class: 'setup-checks' }, store.all().filter((s) => s.entity_id.startsWith('climate.'))
          .filter((s) => !cfg.floorplans.some((p) => (p.rooms ?? []).some((r) => r.climate === s.entity_id)))
          .map((s) => {
            cfg.climates ??= [];
            const on = cfg.climates.some((c) => c.entity === s.entity_id);
            const box = el('input', { type: 'checkbox', checked: on });
            box.addEventListener('change', () => {
              cfg.climates = cfg.climates.filter((c) => c.entity !== s.entity_id);
              if (box.checked) cfg.climates.push({ entity: s.entity_id, name: s.attributes?.friendly_name ?? s.entity_id });
              changed();
            });
            return el('li', {}, el('label', {}, box, ` ${s.attributes?.friendly_name ?? s.entity_id}`, el('span', { class: 'muted small' }, ` · ${s.entity_id}`)));
          }))),
    ];
  }

  // ---------- 5. buttons
  function buttons() {
    const list = store.all().filter((s) => /^(scene|script)\./.test(s.entity_id))
      .sort((a, b) => (a.attributes?.friendly_name ?? a.entity_id).localeCompare(b.attributes?.friendly_name ?? b.entity_id, site.locale));
    return [
      intro('setup.buttonsIntro'),
      section(t('setup.step.buttons'), list.length ? el('ul', { class: 'setup-checks' }, list.map((s) => {
        const current = cfg.scenes.find((x) => x.entity === s.entity_id);
        const box = el('input', { type: 'checkbox', checked: !!current });
        const name = input(current?.name ?? s.attributes?.friendly_name ?? s.entity_id, (v) => {
          const x = cfg.scenes.find((y) => y.entity === s.entity_id);
          if (x) x.name = v;
        }, { 'aria-label': t('setup.buttonName') });
        box.addEventListener('change', () => {
          cfg.scenes = cfg.scenes.filter((x) => x.entity !== s.entity_id);
          if (box.checked) cfg.scenes.push({ entity: s.entity_id, name: name.value });
          changed();
        });
        return el('li', { class: 'setup-check-row' }, box, name, el('span', { class: 'muted small' }, s.entity_id));
      })) : el('p', { class: 'muted small' }, t('setup.noScenes'))),
    ];
  }

  // ---------- 6. lights and heating
  function lights() {
    const roomCount = cfg.floorplans.reduce((n, p) => n + (p.rooms ?? []).length, 0);
    return [
      intro('setup.lightsIntro'),
      el('ol', { class: 'setup-steps' },
        el('li', {}, t('setup.lightsStep1')),
        el('li', {}, t('setup.lightsStep2')),
        el('li', {}, t('setup.lightsStep3'))),
      roomCount || cfg.overview?.image
        ? el('button', { class: 'chip chip-primary', type: 'button', onclick: async () => {
          if (dirty) { await saveSite(cfg); dirty = false; }
          openPlacement();
        } }, t(dirty ? 'setup.saveAndPlace' : 'setup.openPlacement'))
        : el('p', { class: 'muted small' }, t('setup.lightsNeedPictures')),
    ];
  }

  // ---------- polygon drawing on a picture
  function drawButton(label, opts, onDone) {
    return el('button', { class: 'chip', type: 'button', onclick: () => draw({ ...opts, title: label }, (poly, picked) => { onDone(poly, picked); changed(); render(); }) }, label);
  }

  function draw({ src, size: [w, h], shapes, title, point = false, pick = null }, onDone) {
    // pick = { label, options: [[value, text]] }: chosen while drawing, handed to onDone.
    const picker = pick ? select(pick.options, '', () => {}, { 'aria-label': pick.label }) : null;
    let points = [];
    const live = sv('polyline', { class: 'draw-live' });
    const dots = sv('g', { class: 'draw-dots' });
    const scale = Math.max(w, h) / 160;
    const svgEl = sv('svg', { viewBox: `0 0 ${w} ${h}`, class: 'draw-svg', preserveAspectRatio: 'xMidYMid meet' },
      sv('image', { href: src, width: w, height: h }),
      shapes.map((s) => sv('g', { class: `draw-shape draw-${s.kind}` },
        sv('polygon', { points: pts(s.points), 'stroke-width': scale * 0.35 }),
        s.label ? sv('text', { x: centroid(s.points)[0], y: centroid(s.points)[1], 'font-size': scale * 2.4, 'text-anchor': 'middle' }, s.label) : null)),
      live, dots);
    live.setAttribute('stroke-width', scale * 0.45);
    const count = el('span', { class: 'muted small' });
    const doneBtn = el('button', { class: 'chip chip-primary', type: 'button', disabled: true }, t('setup.drawDone'));
    const redraw = () => {
      live.setAttribute('points', pts(points.length > 2 ? [...points, points[0]] : points));
      dots.replaceChildren(...points.map(([x, y]) => sv('circle', { cx: x, cy: y, r: scale * 0.9 })));
      count.textContent = t('setup.drawCount', { n: points.length });
      doneBtn.disabled = points.length < 3;
    };
    svgEl.addEventListener('click', (e) => {
      const p = svgPoint(svgEl, e);
      if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) return;
      points.push([Math.round(p.x), Math.round(p.y)]);
      if (point) { overlay.remove(); onDone(points, picker?.value); return; }
      redraw();
    });
    const overlay = el('div', { class: 'draw' },
      el('div', { class: 'draw-bar' },
        el('div', {}, el('strong', {}, title), el('p', { class: 'muted small' }, t(point ? 'setup.pointHelp' : 'setup.drawHelp'))),
        el('div', { class: 'row' }, picker ? el('label', { class: 'draw-pick' }, el('span', { class: 'small muted' }, pick.label), picker) : null, count,
          el('button', { class: 'chip', type: 'button', onclick: () => { points.pop(); redraw(); } }, t('editor.undo')),
          el('button', { class: 'chip', type: 'button', onclick: () => overlay.remove() }, t('setup.cancel')),
          doneBtn)),
      el('div', { class: 'draw-stage' }, svgEl));
    doneBtn.addEventListener('click', () => { overlay.remove(); onDone(points, picker?.value); });
    redraw();
    root.append(overlay);
  }

  render();
  return { el: root };
}
