// Setup guide, step: the overview picture (day and evening picture, buildings, solar
// panels, windows, where the energy lines meet).

import { el } from '../../util.js';
import { t } from '../../i18n.js';
import { areaName } from '../../areas.js';

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

export function overviewStep(ctx) {
  const { cfg, areas, status, changed, render, picture, field, section, intro, isExample, exampleNote, input, select, fileButton, ext, imageSize, upload, slug, uniqueId, rooms, freeAreas, areaPick, drawButton, shapeButton } = ctx;
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
      el('button', { class: 'chip chip-danger', type: 'button', onclick: () => { delete cfg.overview; changed(); ctx.step = 'plans'; render(); } }, t('setup.removeOverview'))));

    // buildings
    const bList = el('ul', { class: 'setup-list setup-rooms' }, (ov.buildings ?? []).map((b, i) => el('li', {},
      areas.list.length ? select([['', t('setup.noArea')], ...freeAreas(b.ha_area)], b.ha_area, (v) => {
        if (v) { b.ha_area = v; b.name = areaName(areas, v); } else delete b.ha_area;
        render();
      }, { 'aria-label': t('setup.area') }) : null,
      b.ha_area && areaName(areas, b.ha_area)
        ? el('span', { class: 'setup-room-name' }, areaName(areas, b.ha_area))
        : input(b.name, (v) => { b.name = v; }, { 'aria-label': t('setup.name') }),
      cfg.floorplans.length
        ? select([['', t('setup.opensNoPlan')], ...cfg.floorplans.map((p) => [p.id, t('setup.opensPlan', { name: p.name })])], b.floorplan, (v) => { if (v) b.floorplan = v; else delete b.floorplan; }, { 'aria-label': t('setup.floorPlan') })
        : el('span', { class: 'muted small' }, t('setup.noPlansYet')),
      b.area?.length > 2 ? shapeButton(t('setup.editShapeOf', { name: b.name }), {
        src: picture(ov.image), size: ov.size, points: b.area, kind: 'building',
        shapes: overviewShapes().filter((s) => s.points !== b.area),
      }, (poly) => { b.area = poly; status.textContent = t('setup.shapeSaved', { name: b.name }); }) : null,
      el('button', { class: 'chip chip-danger', type: 'button', onclick: () => { ov.buildings.splice(i, 1); changed(); render(); } }, t('setup.remove')))));
    out.push(section(t('setup.buildings'), el('p', { class: 'muted small' }, t('setup.buildingsHelp')), bList,
      drawButton(t('setup.drawBuilding'), { src: picture(ov.image), size: ov.size, shapes: overviewShapes(), pick: areaPick() }, (poly, areaId) => {
        ov.buildings ??= [];
        const name = (areaId && areaName(areas, areaId)) || t('setup.building', { n: ov.buildings.length + 1 });
        const b = { id: uniqueId(slug(name), ov.buildings.map((x) => x.id)), name, area: poly, ...(areaId ? { ha_area: areaId } : {}) };
        // Plans added first: a single plan no building opens yet goes with the new building.
        const [only, ...more] = cfg.floorplans;
        if (only && !more.length && !ov.buildings.some((x) => x.floorplan === only.id)) b.floorplan = only.id;
        ov.buildings.push(b);
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

  return overview;
}
