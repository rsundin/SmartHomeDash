// Setup guide, step: buttons (scenes and scripts, and all on / all off).

import { el } from '../../util.js';
import { t } from '../../i18n.js';
import { nameOf } from '../../entities.js';

export function buttonsStep(ctx) {
  const { cfg, site, store, changed, section, intro, input, label } = ctx;
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

  return buttons;
}
