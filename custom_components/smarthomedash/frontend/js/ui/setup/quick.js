// Setup guide: quick start. Plans from Home Assistant's floors and areas, no drawing.

import { el } from '../../util.js';
import { t } from '../../i18n.js';
import { quickStart } from '../../areas.js';

export function createQuickStart(ctx) {
  const { cfg, areas, status, changed, render, section, isExample } = ctx;
  // Offered until the site has floor plans of its own. Example pictures from the starter
  // site belong to the example rooms, so the quick start takes their place.
  // An example plan nobody has linked or placed anything in yet.
  const untouched = (p) => isExample(p.image?.src ?? p.image)
    && !(p.rooms ?? []).some((r) => r.ha_area || r.lights?.length || r.climate || r.temperature);
  // The example overview goes with them, unless something was added to it.
  const untouchedOverview = (c) => isExample(c.overview?.image) && !(c.overview.zones ?? []).length
    && (c.overview.buildings ?? []).every((b) => !b.floorplan || !c.floorplans.some((p) => p.id === b.floorplan && !untouched(p)));
  function freshAreas() {
    if (cfg.floorplans.some((p) => !untouched(p))) return [];
    return areas.list;
  }
  function quickStartSection() {
    const free = freshAreas();
    if (!free.length) return null;
    const examples = cfg.floorplans.length > 0 || untouchedOverview(cfg);
    return section(t('setup.quickTitle'),
      el('p', { class: 'muted small' }, t('setup.quickHelp', { n: free.length })),
      examples ? el('p', { class: 'muted small' }, t('setup.quickReplaces')) : null,
      el('button', { class: 'chip chip-primary', type: 'button', onclick: startFromHa }, t('setup.quickStart')));
  }
  function startFromHa() {
    const next = structuredClone(cfg);
    if (untouchedOverview(next)) delete next.overview;
    next.floorplans = next.floorplans.filter((p) => !untouched(p));
    for (const b of next.overview?.buildings ?? []) if (b.floorplan && !next.floorplans.some((p) => p.id === b.floorplan)) delete b.floorplan;
    const added = quickStart(next, areas, { otherName: t('setup.otherRooms'), homeName: t('setup.homePlan') });
    if (!added.plans) { status.textContent = t('setup.quickNothing'); return; }
    cfg.floorplans = next.floorplans;
    if (next.overview) cfg.overview = next.overview; else delete cfg.overview;
    changed();
    ctx.step = 'plans';
    render();
    status.textContent = t('setup.quickDone', added);
  }

  return { untouched, untouchedOverview, quickStartSection };
}
