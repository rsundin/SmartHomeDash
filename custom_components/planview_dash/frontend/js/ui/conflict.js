import { el } from '../util.js';
import { t } from '../i18n.js';

// Asked when a save was refused because site.json has been saved by someone else, or in
// another tab, since this editor read it. Resolves true for "save anyway".
export function confirmOverwrite() {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const done = (answer) => {
      document.removeEventListener('keydown', onKey, true);
      root.remove();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      resolve(answer);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    const cancel = el('button', { class: 'chip chip-primary', type: 'button', onclick: () => done(false) }, t('setup.cancel'));
    const root = el('div', { class: 'sheet save-conflict' },
      el('div', { class: 'sheet-card', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'save-conflict-title', 'aria-describedby': 'save-conflict-text' },
        el('header', { class: 'panel-head' }, el('h2', { class: 'panel-title', id: 'save-conflict-title' }, t('save.conflictTitle'))),
        el('p', { id: 'save-conflict-text' }, t('save.conflict')),
        el('div', { class: 'row' }, cancel,
          el('button', { class: 'chip chip-danger', type: 'button', onclick: () => done(true) }, t('save.anyway')))));
    document.addEventListener('keydown', onKey, true);
    document.body.append(root);
    cancel.focus({ preventScroll: true });
  });
}
