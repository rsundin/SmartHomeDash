// Setup guide, step: lights and heating (hands over to placement mode).

import { el } from '../../util.js';
import { t } from '../../i18n.js';

export function lightsStep(ctx) {
  const { cfg, saveSite, openPlacement, intro } = ctx;
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
          if (ctx.dirty) { await saveSite(cfg); ctx.dirty = false; }
          openPlacement();
        } }, t(ctx.dirty ? 'setup.saveAndPlace' : 'setup.openPlacement'))
        : el('p', { class: 'muted small' }, t('setup.lightsNeedPictures')),
    ];
  }

  return lights;
}
