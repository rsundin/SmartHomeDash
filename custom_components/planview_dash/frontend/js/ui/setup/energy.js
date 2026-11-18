// Setup guide, step: energy (power, energy, price and weather entities).

import { el } from '../../util.js';
import { t } from '../../i18n.js';
import { readPower, kwText, MIN_KW } from '../../power.js';

export function energyStep(ctx) {
  const { cfg, store, changed, render, field, section, intro, select, label, entityOptions } = ctx;
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
      direction(E),
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
              if (box.checked) cfg.climates.push({ entity: s.entity_id, name: label(s) });
              changed();
            });
            return el('li', {}, el('label', {}, box, ` ${label(s)}`, el('span', { class: 'muted small' }, ` · ${s.entity_id}`)));
          }))),
    ];
  }

  // Inverters disagree on which way is positive. Show what the dashboard reads right now,
  // so a battery that is discharging but shown as charging is easy to spot and flip.
  function direction(E) {
    if (!E.grid_power && !E.battery_power) return null;
    const p = readPower(store, E);
    const now = (k) => {
      const v = p[k];
      if (v == null) return t('setup.dirUnknown');
      if (Math.abs(v) < MIN_KW) return t('setup.dirIdle');
      const word = k === 'grid' ? (v > 0 ? 'flow.buying' : 'flow.selling') : (v > 0 ? 'flow.batteryOut' : 'flow.batteryIn');
      return `${t(word)} ${kwText(Math.abs(v), cfg.locale)}`;
    };
    const item = (k, key, label) => {
      if (!E[`${k}_power`]) return null;
      const box = el('input', { type: 'checkbox', checked: !!E[key] });
      box.addEventListener('change', () => { if (box.checked) E[key] = true; else delete E[key]; changed(); render(); });
      return el('li', {}, el('label', {}, box, ` ${label}`), el('span', { class: 'muted small' }, ` · ${t('setup.dirNow', { now: now(k) })}`));
    };
    return section(t('setup.direction'), el('p', { class: 'muted small' }, t('setup.directionHelp')),
      el('ul', { class: 'setup-checks' },
        item('battery', 'battery_invert', t('setup.dirBattery')),
        item('grid', 'grid_invert', t('setup.dirGrid'))));
  }

  return energy;
}
