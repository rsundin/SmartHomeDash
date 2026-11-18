// Setup guide step "Backup": download the dashboard as a .zip, import one, and go back
// to one of the last saved versions of site.json (roadmap S3).
//
// `backup` comes from the panel (admins only) and talks to Home Assistant:
//   exportZip()  -> { blob, name }     the site as a .zip
//   importZip(file)                    replaces site.json and adds the pictures
//   versions()   -> { versions, keep } the kept versions, newest first
//   restore(n)                         makes version n the current site.json
// Import and restore restart the dashboard; the replaced config becomes a restore point.

import { el } from '../util.js';
import { t } from '../i18n.js';
import { noteProblem } from './report.js';

export function backupStep({ backup, locale, status, reload, unsaved = () => false }) {
  const section = (title, ...kids) => el('section', { class: 'setup-section' }, el('h3', { class: 'eyebrow' }, title), ...kids);
  const fail = (key, e) => { noteProblem(e.message); status.textContent = t(key, { msg: e.message }); };
  const done = (message) => { status.textContent = message; setTimeout(reload, 500); };
  const warnUnsaved = () => (unsaved() ? el('p', { class: 'setup-note' }, t('backup.unsaved')) : null);

  // ---------- export
  const exportBtn = el('button', { class: 'chip chip-primary backup-export', type: 'button', onclick: async () => {
    exportBtn.disabled = true;
    status.textContent = t('backup.exporting');
    try {
      const { blob, name } = await backup.exportZip();
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: name, hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      status.textContent = t('backup.exported', { name });
    } catch (e) {
      fail('backup.exportFailed', e);
    } finally {
      exportBtn.disabled = false;
    }
  } }, t('backup.export'));

  // ---------- import: choose a file, then confirm what it replaces
  const confirmRow = el('div', { class: 'row backup-confirm', hidden: true });
  const fileInput = el('input', { type: 'file', accept: '.zip,application/zip', hidden: true, class: 'backup-file' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    confirmRow.hidden = false;
    confirmRow.replaceChildren(
      el('span', {}, t('backup.importConfirm', { name: file.name })),
      el('button', { class: 'chip chip-danger backup-import-go', type: 'button', onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        status.textContent = t('backup.importing');
        try {
          await backup.importZip(file);
          confirmRow.hidden = true;
          done(t('backup.imported'));
        } catch (err) {
          btn.disabled = false;
          fail('backup.importFailed', err);
        }
      } }, t('backup.importGo')),
      el('button', { class: 'chip', type: 'button', onclick: () => { confirmRow.hidden = true; } }, t('setup.cancel')));
  });

  // ---------- restore points
  const list = el('ul', { class: 'setup-list backup-versions' }, el('li', { class: 'muted small' }, t('backup.loading')));
  const when = (ms) => new Date(ms).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const describe = (v) => [
    v.name,
    v.broken ? t('backup.broken') : t('backup.counts', { plans: v.floorplans ?? 0, rooms: v.rooms ?? 0 }),
  ].filter(Boolean).join(' · ');
  function row(v) {
    const go = el('button', { class: 'chip backup-restore', type: 'button', disabled: !!v.broken }, t('backup.restore'));
    const li = el('li', {}, el('strong', {}, when(v.saved)), el('span', { class: 'muted small' }, describe(v)), go);
    go.addEventListener('click', () => {
      go.replaceWith(el('span', { class: 'row' },
        el('button', { class: 'chip chip-danger backup-restore-go', type: 'button', onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          status.textContent = t('backup.restoring');
          try {
            await backup.restore(v.version);
            done(t('backup.restored', { when: when(v.saved) }));
          } catch (err) {
            btn.disabled = false;
            fail('backup.restoreFailed', err);
          }
        } }, t('backup.restoreGo')),
        el('button', { class: 'chip', type: 'button', onclick: () => refresh() }, t('setup.cancel'))));
    });
    return li;
  }
  async function refresh() {
    try {
      const { versions = [] } = await backup.versions();
      list.replaceChildren(...(versions.length ? versions.map(row) : [el('li', { class: 'muted small' }, t('backup.noVersions'))]));
    } catch (e) {
      list.replaceChildren(el('li', { class: 'muted small' }, t('backup.versionsFailed', { msg: e.message })));
    }
  }
  refresh();

  return [
    el('p', { class: 'setup-intro' }, t('backup.intro')),
    warnUnsaved(),
    section(t('backup.exportTitle'), el('p', { class: 'muted small' }, t('backup.exportHelp')), exportBtn),
    section(t('backup.importTitle'), el('p', { class: 'muted small' }, t('backup.importHelp')),
      el('span', {}, fileInput, el('button', { class: 'chip backup-import', type: 'button', onclick: () => fileInput.click() }, t('backup.import'))),
      confirmRow),
    section(t('backup.versionsTitle'), el('p', { class: 'muted small' }, t('backup.versionsHelp')), list),
  ].filter(Boolean);
}
