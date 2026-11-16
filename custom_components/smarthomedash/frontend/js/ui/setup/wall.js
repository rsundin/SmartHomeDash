// Setup guide, step: wall screen (doorbell camera, idle mode, light mode).

import { el } from '../../util.js';
import { t } from '../../i18n.js';

export function wallStep(ctx) {
  const { cfg, site, store, changed, field, section, intro, input, select, label, entityOptions } = ctx;
  function wall() {
    const W = (cfg.wall_screen ??= {});
    // Drop what is empty, so an untouched step leaves site.json as it was.
    const tidy = () => {
      if (W.doorbell && !W.doorbell.entity && !W.doorbell.camera) delete W.doorbell;
      if (W.idle) {
        if (!W.idle.wake?.length) delete W.idle.wake;
        if (!W.idle.dim_from || !W.idle.dim_to) { delete W.idle.dim_from; delete W.idle.dim_to; delete W.idle.dim; }
        if (!Object.keys(W.idle).length) delete W.idle;
      }
      if (!W.lite) delete W.lite;
      if (!Object.keys(W).length) delete cfg.wall_screen;
      else cfg.wall_screen = W;
    };
    const bell = () => (W.doorbell ??= {});
    const idle = () => (W.idle ??= {});
    const set = (obj, key) => (v) => { if (v) obj()[key] = v; else delete obj()[key]; tidy(); };
    const ringers = (s) => /^(binary_sensor|event|button|input_button|input_boolean)\./.test(s.entity_id);
    const motion = store.all().filter((s) => s.entity_id.startsWith('binary_sensor.') && ['motion', 'occupancy', 'presence'].includes(s.attributes?.device_class))
      .sort((a, b) => label(a).localeCompare(label(b), site.locale));
    const backAfter = String(W.idle?.back_after ?? 120);
    const dimLevel = String(W.idle?.dim ?? 0.85);
    return [
      intro('setup.wallIntro'),
      section(t('setup.doorbell'),
        el('p', { class: 'muted small' }, t('setup.doorbellHelp')),
        field(t('setup.doorbellEntity'), select(entityOptions(ringers), W.doorbell?.entity, set(bell, 'entity'))),
        field(t('setup.doorbellCamera'), select(entityOptions((s) => s.entity_id.startsWith('camera.')), W.doorbell?.camera, set(bell, 'camera'))),
        field(t('setup.doorbellName'), input(W.doorbell?.name, (v) => set(bell, 'name')(v.trim()), { placeholder: t('wall.door') })),
        field(t('setup.doorbellSeconds'), input(W.doorbell?.seconds ?? 60, (v) => set(bell, 'seconds')(parseInt(v, 10) || null), { type: 'number', min: '5', step: '5' }))),
      section(t('setup.idle'),
        el('p', { class: 'muted small' }, t('setup.idleHelp')),
        field(t('setup.idleBack'), select([['0', t('setup.idleNever')], ...[30, 60, 120, 300, 600].map((n) => [String(n), t(n < 60 ? 'setup.seconds' : 'setup.minutes', { n: n < 60 ? n : n / 60 })])], backAfter, (v) => { idle().back_after = Number(v); tidy(); })),
        el('div', { class: 'row' },
          field(t('setup.dimFrom'), input(W.idle?.dim_from, set(idle, 'dim_from'), { type: 'time' })),
          field(t('setup.dimTo'), input(W.idle?.dim_to, set(idle, 'dim_to'), { type: 'time' }))),
        field(t('setup.dimLevel'), select([['0.6', t('setup.dimLight')], ['0.85', t('setup.dimMedium')], ['0.95', t('setup.dimDark')]], dimLevel, (v) => { idle().dim = Number(v); tidy(); }), t('setup.dimHelp')),
        el('p', { class: 'setup-label' }, t('setup.wake')),
        motion.length ? el('ul', { class: 'setup-checks' }, motion.map((s) => {
          const box = el('input', { type: 'checkbox', checked: (W.idle?.wake ?? []).includes(s.entity_id) });
          box.addEventListener('change', () => {
            const list = (idle().wake ?? []).filter((id) => id !== s.entity_id);
            if (box.checked) list.push(s.entity_id);
            idle().wake = list;
            tidy();
            changed();
          });
          return el('li', {}, el('label', {}, box, ` ${label(s)}`, el('span', { class: 'muted small' }, ` · ${s.entity_id}`)));
        })) : el('p', { class: 'muted small' }, t('setup.noMotion'))),
      section(t('setup.lite'),
        el('label', {}, (() => {
          const box = el('input', { type: 'checkbox', checked: !!W.lite });
          box.addEventListener('change', () => { W.lite = box.checked; tidy(); changed(); });
          return box;
        })(), ` ${t('setup.liteAll')}`),
        el('p', { class: 'muted small' }, t('setup.liteHelp'))),
    ];
  }

  return wall;
}
