// Connection settings, kept per site in this browser only.

import { el, storage } from '../util.js';
import { t } from '../i18n.js';

export const connKey = (siteId) => `shd:${siteId}:conn`;

export function createSettings({ site, source }) {
  const saved = storage.get(connKey(site.id), {}) || {};
  const url = el('input', { id: 'ha-url', type: 'url', placeholder: t('settings.addressPlaceholder'), value: saved.url || '' });
  const token = el('input', { id: 'ha-token', type: 'password', autocomplete: 'off', placeholder: 'Long-lived access token', value: saved.token || '' });
  const msg = el('p', { class: 'muted small', role: 'status' });

  const form = el('form', { class: 'settings-form' },
    el('label', { for: 'ha-url' }, t('settings.address')), url,
    el('label', { for: 'ha-token' }, t('settings.token')), token,
    el('p', { class: 'muted small' },
      t('settings.tokenHelp')),
    el('div', { class: 'row' },
      el('button', { class: 'chip chip-primary', type: 'submit' }, t('settings.save')),
      el('button', { class: 'chip', type: 'button', onclick: () => { storage.set(connKey(site.id), null); location.reload(); } }, t('settings.useTest'))),
    msg);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!token.value.trim()) { msg.textContent = t('settings.needToken'); return; }
    storage.set(connKey(site.id), { url: url.value.trim(), token: token.value.trim() });
    location.reload();
  });

  const root = el('div', { class: 'sheet', hidden: true },
    el('div', { class: 'sheet-card', role: 'dialog', 'aria-label': t('settings.connection') },
      el('header', { class: 'panel-head' },
        el('div', {}, el('p', { class: 'eyebrow' }, t('settings.title')), el('h2', { class: 'panel-title' }, t('settings.connection'))),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('settings.close'), onclick: () => { root.hidden = true; } }, '×')),
      el('p', { class: 'small' }, t(`settings.source.${source}`)),
      form,
      el('p', { class: 'muted small settings-version' }, t('settings.version', { v: window.SHD_VERSION ?? '–' }))));
  root.addEventListener('click', (e) => { if (e.target === root) root.hidden = true; });
  return { el: root, open: () => { root.hidden = false; url.focus(); } };
}
