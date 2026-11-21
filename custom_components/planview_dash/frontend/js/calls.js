// Every call the dashboard makes to Home Assistant goes through here, so a failed one is
// said on the screen ("Couldn't turn on Kitchen ceiling") instead of failing silently in
// the console: a lamp that is offline, a thermostat that refuses, a lost connection.
//
// guardCalls() wraps an adapter: its call() never rejects. It resolves to what Home
// Assistant answered, or to false after a failure has been shown. A caller that says
// more itself passes { onError } and gets the error instead of the shared message.

import { t } from './i18n.js';
import { isOn, nameOf } from './entities.js';

export function guardCalls(adapter, { store, site, say }) {
  const guarded = Object.create(adapter);
  guarded.call = async (domain, service, data = {}, { onError } = {}) => {
    // Toggle says on or off from the state before the call.
    const text = () => failText(domain, service, data, { store, site });
    const message = service === 'toggle' ? text() : null;
    try {
      return await adapter.call(domain, service, data);
    } catch (e) {
      console.warn(`PlanView Dash: ${domain}.${service} failed`, e);
      if (onError) onError(e); else say(message ?? text());
      return false;
    }
  };
  return guarded;
}

// "Couldn't turn on Kitchen ceiling", "Couldn't turn off 12 devices", "Couldn't start Movie night".
export function failText(domain, service, data, { store, site }) {
  const ids = [].concat(data?.entity_id ?? []);
  const label = (id) => nameOf(id, { store, site }, site?.index?.names?.get(id) ?? id);
  const name = domain === 'planview_dash' ? t('goodnight.button')
    : ids.length === 1 ? label(ids[0])
      : ids.length > 1 ? t('call.devices', { n: ids.length })
        : `${domain}.${service}`;
  const on = service === 'turn_on' || (service === 'toggle' && ids.length === 1 && !isOn(store?.get(ids[0])));
  const off = service === 'turn_off' || (service === 'toggle' && !on);
  const starts = ((domain === 'scene' || domain === 'script') && service === 'turn_on') || (domain === 'planview_dash' && !data?.cancel);
  const key = starts ? 'call.failedStart'
    : on ? 'call.failedOn' : off ? 'call.failedOff' : 'call.failed';
  return t(key, { name });
}
