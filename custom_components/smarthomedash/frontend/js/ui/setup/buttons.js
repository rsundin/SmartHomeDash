// Setup guide, step: buttons (scenes and scripts).

import { el } from '../../util.js';
import { t } from '../../i18n.js';

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
    ];
  }

  return buttons;
}
