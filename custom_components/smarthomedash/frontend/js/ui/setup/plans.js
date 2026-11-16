// Setup guide, step: floor plans (a picture per plan, rooms drawn on it and linked to
// Home Assistant areas).

import { el, centroid, bbox, inside } from '../../util.js';
import { t } from '../../i18n.js';
import { areaName, floorName, fillRoomFromArea, matchRoomsByName, fitTilesToPicture } from '../../areas.js';

export function plansStep(ctx) {
  const { cfg, store, areas, status, changed, render, picture, field, section, intro, isExample, exampleNote, input, select, fileButton, ext, imageSize, upload, slug, uniqueId, freeAreas, areaPick, drawButton, shapeButton, quickStartSection } = ctx;
  function plans() {
    const out = [intro('setup.plansIntro')];
    if (cfg.floorplans.some((p) => isExample(p.image?.src ?? p.image))) out.push(exampleNote('setup.examplePlans'));
    const quick = quickStartSection();
    if (quick) out.push(quick);
    for (const [pi, plan] of cfg.floorplans.entries()) {
      const src = plan.image ? picture(typeof plan.image === 'string' ? plan.image : plan.image.src) : null;
      const size = plan.image?.bounds ? [plan.image.bounds[2], plan.image.bounds[3]] : null;
      const roomList = el('ul', { class: 'setup-list setup-rooms' }, (plan.rooms ?? []).map((r, i) => el('li', {},
        areas.list.length ? areaSelect(r) : null,
        r.ha_area && areaName(areas, r.ha_area)
          ? el('span', { class: 'setup-room-name' }, areaName(areas, r.ha_area))
          : input(r.name, (v) => { r.name = v; }, { 'aria-label': t('setup.name') }),
        el('span', { class: 'muted small' }, roomSummary(r)),
        r.redraw && src && size ? drawButton(t('setup.redrawRoom', { room: r.name }), { src, size, shapes: (plan.rooms ?? []).filter((x) => x !== r && !x.redraw).map((x) => ({ points: x.area, label: x.name, kind: 'room' })) }, (poly) => redrawRoom(r, poly)) : null,
        !r.redraw && src && size && r.area?.length > 2 ? shapeButton(t('setup.editShapeOf', { name: r.name }), {
          src, size, points: r.area, kind: 'room', step: plan.unit === 'px' ? 1 : 10,
          shapes: (plan.rooms ?? []).filter((x) => x !== r && !x.redraw && x.area?.length > 2).map((x) => ({ points: x.area, label: x.name, kind: 'room' })),
        }, (poly, shift) => reshapeRoom(r, poly, shift)) : null,
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
          cfg.overview?.buildings?.length ? buildingField(plan) : null,
          el('button', { class: 'chip chip-danger', type: 'button', onclick: () => {
            cfg.floorplans.splice(pi, 1);
            for (const b of cfg.overview?.buildings ?? []) if (b.floorplan === plan.id) delete b.floorplan;
            changed(); render();
          } }, t('setup.removePlan'))),
        src ? el('img', { class: 'setup-plan-thumb', src, alt: plan.name })
          : el('div', { class: 'setup-field' },
            el('p', { class: 'muted small' }, t(plan.layout === 'tiles' ? 'setup.planTiles' : 'setup.planNoPicture')),
            el('div', { class: 'row' }, fileButton(t('setup.uploadPlanPicture'), (f) => addPlanPicture(plan, f).catch((e) => { status.textContent = e.message; })))),
        (plan.rooms ?? []).some((r) => r.redraw) ? el('p', { class: 'setup-note' }, t('setup.redrawNote')) : null,
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

  // A picture for a plan that has none (one from the quick start): the rooms keep their
  // areas and lights, stretched over the picture until each is drawn where it really is.
  async function addPlanPicture(plan, file) {
    const size = await imageSize(file);
    const path = `plan_${plan.id}.${ext(file)}`;
    await upload(file, path);
    plan.image = { src: path, bounds: [0, 0, size[0], size[1]] };
    if ((plan.rooms ?? []).length) fitTilesToPicture(plan, size);
    else { plan.outline = [[0, 0], [size[0], 0], [size[0], size[1]], [0, size[1]]]; delete plan.layout; }
    render();
  }
  function redrawRoom(room, poly) {
    room.area = poly;
    delete room.redraw;
    delete room.label;
    lightsInside(room, poly);
    status.textContent = t('setup.redrawn', { room: room.name });
  }
  // A room moved as a whole takes its lamps and its name along; a lamp left outside
  // the new corners moves in.
  function reshapeRoom(room, poly, [dx, dy] = [0, 0]) {
    room.area = poly;
    if (dx || dy) {
      for (const l of room.lights ?? []) if (l.at) l.at = [l.at[0] + dx, l.at[1] + dy];
      if (Array.isArray(room.label)) room.label = [room.label[0] + dx, room.label[1] + dy];
    }
    if (Array.isArray(room.label) && !inside(room.label, poly)) delete room.label;
    lightsInside(room, poly);
    status.textContent = t('setup.shapeSaved', { name: room.name });
  }
  // Lights outside the room's corners (placed on an old tile or shape) move into it.
  function lightsInside(room, poly) {
    const out = (room.lights ?? []).filter((l) => l.at && !inside(l.at, poly));
    if (out.length) {
      const [cx, cy] = centroid(poly);
      const box = bbox([poly]);
      const r = out.length > 1 ? Math.min(box.w, box.h) * 0.22 : 0;
      out.forEach((l, i) => {
        const a = (i / out.length) * Math.PI * 2 - Math.PI / 2;
        l.at = [Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)];
      });
    }
  }

  // Which building on the overview picture opens this plan, lifting its roof when tapped.
  // A building opens one plan, so picking it here moves it off any other plan.
  function buildingField(plan) {
    const buildings = cfg.overview.buildings;
    const current = buildings.find((b) => b.floorplan === plan.id);
    const options = [['', t('setup.noBuilding')], ...buildings.map((b) => [b.id, b.name])];
    return field(t('setup.buildingLabel'), select(options, current?.id, (v) => {
      for (const b of buildings) if (b.floorplan === plan.id) delete b.floorplan;
      const b = buildings.find((x) => x.id === v);
      if (b) b.floorplan = plan.id;
      render();
    }, { 'aria-label': t('setup.buildingLabel') }));
  }


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

  return plans;
}
