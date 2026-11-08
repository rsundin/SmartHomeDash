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

const STEPS = ['basics', 'overview', 'plans', 'energy', 'buttons', 'lights'];

export function createSetup({ site, store, saveSite, uploadFile, reload, openPlacement }) {
  const cfg = structuredClone(site.raw);
  cfg.floorplans ??= [];
  cfg.energy ??= {};
  cfg.scenes ??= [];
  const previews = new Map(); // path -> object URL for pictures uploaded in this session
  const picture = (path) => previews.get(path) ?? site.asset(path);
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
  function close() {
    if (dirty && !root.dataset.confirmClose) {
      root.dataset.confirmClose = '1';
      status.textContent = t('setup.closeConfirm');
      setTimeout(() => { delete root.dataset.confirmClose; if (dirty) status.textContent = t('setup.unsaved'); }, 4000);
      return;
    }
    root.remove();
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
    n.addEventListener('change', () => { onChange(n.value); changed(); });
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
    if (!ov?.image) return out;
    out.push(section(t('setup.removeOverview'), el('p', { class: 'muted small' }, t('setup.removeOverviewHelp')),
      el('button', { class: 'chip chip-danger', type: 'button', onclick: () => { delete cfg.overview; changed(); step = 'plans'; render(); } }, t('setup.removeOverview'))));

    // buildings
    const bList = el('ul', { class: 'setup-list' }, (ov.buildings ?? []).map((b, i) => el('li', {},
      input(b.name, (v) => { b.name = v; }, { 'aria-label': t('setup.name') }),
      select([['', t('setup.noPlan')], ...cfg.floorplans.map((p) => [p.id, p.name])], b.floorplan, (v) => { if (v) b.floorplan = v; else delete b.floorplan; }, { 'aria-label': t('setup.floorPlan') }),
      el('button', { class: 'chip chip-danger', type: 'button', onclick: () => { ov.buildings.splice(i, 1); changed(); render(); } }, t('setup.remove')))));
    out.push(section(t('setup.buildings'), el('p', { class: 'muted small' }, t('setup.buildingsHelp')), bList,
      drawButton(t('setup.drawBuilding'), { src: picture(ov.image), size: ov.size, shapes: overviewShapes() }, (poly) => {
        ov.buildings ??= [];
        const name = t('setup.building', { n: ov.buildings.length + 1 });
        ov.buildings.push({ id: uniqueId(slug(name), ov.buildings.map((b) => b.id)), name, area: poly });
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
    out.push(el('p', { class: 'muted small' }, t('setup.outdoorLightsHint')));
    return out;
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
      const roomList = el('ul', { class: 'setup-list' }, (plan.rooms ?? []).map((r, i) => el('li', {},
        input(r.name, (v) => { r.name = v; }, { 'aria-label': t('setup.name') }),
        el('span', { class: 'muted small' }, [r.climate ? t('setup.thermostatShort') : '', r.lights?.length ? `${r.lights.length} ${t('setup.lightsShort')}` : ''].filter(Boolean).join(' ')),
        el('button', { class: 'chip chip-danger', type: 'button', onclick: () => { plan.rooms.splice(i, 1); changed(); render(); } }, t('setup.remove')))));
      out.push(section(plan.name,
        el('div', { class: 'setup-row' },
          field(t('setup.name'), input(plan.name, (v) => { plan.name = v; })),
          el('button', { class: 'chip chip-danger', type: 'button', onclick: () => {
            cfg.floorplans.splice(pi, 1);
            for (const b of cfg.overview?.buildings ?? []) if (b.floorplan === plan.id) delete b.floorplan;
            changed(); render();
          } }, t('setup.removePlan'))),
        src ? el('img', { class: 'setup-plan-thumb', src, alt: plan.name }) : el('p', { class: 'muted small' }, t('setup.planNoPicture')),
        el('h4', { class: 'setup-label' }, t('setup.rooms')), roomList,
        src && size ? drawButton(t('setup.drawRoom'), { src, size, shapes: (plan.rooms ?? []).map((r) => ({ points: r.area, label: r.name, kind: 'room' })) }, (poly) => {
          plan.rooms ??= [];
          const name = t('setup.room') + ` ${plan.rooms.length + 1}`;
          plan.rooms.push({ id: uniqueId(slug(name), cfg.floorplans.flatMap((p) => (p.rooms ?? []).map((r) => r.id))), name, area: poly, lights: [] });
        }) : null));
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
    return el('button', { class: 'chip', type: 'button', onclick: () => draw({ ...opts, title: label }, (poly) => { onDone(poly); changed(); render(); }) }, label);
  }

  function draw({ src, size: [w, h], shapes, title }, onDone) {
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
      redraw();
    });
    const overlay = el('div', { class: 'draw' },
      el('div', { class: 'draw-bar' },
        el('div', {}, el('strong', {}, title), el('p', { class: 'muted small' }, t('setup.drawHelp'))),
        el('div', { class: 'row' }, count,
          el('button', { class: 'chip', type: 'button', onclick: () => { points.pop(); redraw(); } }, t('editor.undo')),
          el('button', { class: 'chip', type: 'button', onclick: () => overlay.remove() }, t('setup.cancel')),
          doneBtn)),
      el('div', { class: 'draw-stage' }, svgEl));
    doneBtn.addEventListener('click', () => { overlay.remove(); onDone(points); });
    redraw();
    root.append(overlay);
  }

  render();
  return { el: root };
}
