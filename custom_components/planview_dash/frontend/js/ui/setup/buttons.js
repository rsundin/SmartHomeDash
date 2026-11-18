// Setup guide, step: buttons (scenes and scripts, all on / all off, and goodnight).

import { el } from '../../util.js';
import { t } from '../../i18n.js';
import { nameOf } from '../../entities.js';

export function buttonsStep(ctx) {
  const { cfg, site, store, changed, section, intro, input, label, select, field, entityOptions } = ctx;
  function buttons() {
    const list = store.all().filter((s) => /^(scene|script)\./.test(s.entity_id))
      .sort((a, b) => label(a).localeCompare(label(b), site.locale));
    return [
      intro('setup.buttonsIntro'),
      section(t('setup.step.buttons'), list.length ? el('ul', { class: 'setup-checks' }, list.map((s) => {
        const current = cfg.scenes.find((x) => x.entity === s.entity_id);
        const box = el('input', { type: 'checkbox', checked: !!current });
        const name = input(current?.name ?? label(s), (v) => {
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
      allLightsSection(),
      goodnightSection(),
    ];
  }

  // All on and all off (ui/lights.js): shown or not, and which lights they leave alone.
  function allLightsSection() {
    const conf = () => (cfg.all_lights ??= {});
    const tidy = () => {
      const a = cfg.all_lights;
      if (!a) return;
      if (a.enabled !== false) delete a.enabled;
      if (!a.exclude?.length) delete a.exclude;
      if (!Object.keys(a).length) delete cfg.all_lights;
    };
    const show = el('input', { type: 'checkbox', checked: cfg.all_lights?.enabled !== false });
    show.addEventListener('change', () => { conf().enabled = show.checked; tidy(); list.hidden = !show.checked; changed(); });
    const ids = [...new Set(site.index.lights)].sort((a, b) => nameOf(a, { store, site }).localeCompare(nameOf(b, { store, site }), site.locale));
    const list = ids.length ? el('ul', { class: 'setup-checks', hidden: !show.checked }, ids.map((id) => {
      const box = el('input', { type: 'checkbox', checked: !(cfg.all_lights?.exclude ?? []).includes(id), 'aria-label': nameOf(id, { store, site }) });
      box.addEventListener('change', () => {
        const ex = new Set(conf().exclude ?? []);
        if (box.checked) ex.delete(id); else ex.add(id);
        conf().exclude = [...ex];
        tidy();
        changed();
      });
      return el('li', { class: 'setup-check-row' }, box, el('span', {}, nameOf(id, { store, site })), el('span', { class: 'muted small' }, id));
    })) : el('p', { class: 'muted small' }, t('setup.allLightsNone'));
    return section(t('setup.allLights'),
      el('label', { class: 'setup-check-row' }, show, el('span', {}, t('setup.allLightsShow'))),
      el('p', { class: 'muted small' }, t('setup.allLightsIntro')),
      list);
  }

  // Goodnight (ui/lights.js, goodnight.py): shown or not, minutes, and a script to run after.
  function goodnightSection() {
    const conf = () => (cfg.goodnight ??= {});
    const tidy = () => {
      const g = cfg.goodnight;
      if (!g) return;
      if (g.enabled !== false) delete g.enabled;
      if (g.minutes == null || g.minutes === 5) delete g.minutes;
      if (!g.then) delete g.then;
      if (!Object.keys(g).length) delete cfg.goodnight;
    };
    const show = el('input', { type: 'checkbox', checked: cfg.goodnight?.enabled !== false });
    const minutes = input(String(cfg.goodnight?.minutes ?? 5), (v) => {
      const n = Number(v.replace(',', '.'));
      if (Number.isFinite(n) && n >= 0 && n <= 120) { conf().minutes = n; tidy(); }
    }, { type: 'number', min: 0, max: 120, step: 1, inputmode: 'decimal', 'aria-label': t('setup.goodnightMinutes') });
    const then = select(entityOptions((s) => s.entity_id.startsWith('script.')), cfg.goodnight?.then ?? '', (v) => { conf().then = v || undefined; tidy(); },
      { 'aria-label': t('setup.goodnightThen') });
    const more = el('div', { hidden: !show.checked }, field(t('setup.goodnightMinutes'), minutes), field(t('setup.goodnightThen'), then, t('setup.goodnightThenHelp')));
    show.addEventListener('change', () => { conf().enabled = show.checked; tidy(); more.hidden = !show.checked; changed(); });
    return section(t('setup.goodnight'),
      el('label', { class: 'setup-check-row' }, show, el('span', {}, t('setup.goodnightShow'))),
      el('p', { class: 'muted small' }, t('setup.goodnightIntro')),
      more);
  }

  return buttons;
}
