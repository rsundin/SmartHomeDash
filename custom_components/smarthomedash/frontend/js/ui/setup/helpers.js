// Setup guide: the small building blocks every step uses (fields, sections, uploads,
// entity and area lists). Returned as an object and added to the shared context.

import { el } from '../../util.js';
import { t } from '../../i18n.js';
import { nameOf } from '../../entities.js';

export function createHelpers(ctx) {
  const { cfg, site, store, areas, status, changed, previews, uploadFile } = ctx;
  const field = (label, control, help) => el('label', { class: 'setup-field' },
    el('span', { class: 'setup-label' }, label), control, help ? el('span', { class: 'muted small' }, help) : null);
  const section = (title, ...kids) => el('section', { class: 'setup-section' }, el('h3', { class: 'eyebrow' }, title), ...kids);
  const intro = (key) => el('p', { class: 'setup-intro' }, t(key));
  // Pictures shipped with the integration are named example_*; flag them until replaced.
  const isExample = (path) => typeof path === 'string' && path.startsWith('example_');
  const exampleNote = (key) => el('p', { class: 'setup-note' }, t(key));
  const input = (value, onInput, attrs = {}) => {
    const n = el('input', { class: 'setup-input', value: value ?? '', ...attrs });
    n.addEventListener('input', () => { onInput(n.value); changed(n); });
    return n;
  };
  const select = (options, value, onChange, attrs = {}) => {
    const n = el('select', { class: 'setup-input', ...attrs },
      options.map(([v, label]) => el('option', { value: v, selected: v === (value ?? '') }, label)));
    n.addEventListener('change', () => { changed(); onChange(n.value); });
    return n;
  };
  const fileButton = (label, onFile) => {
    const inp = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
    inp.addEventListener('change', () => { if (inp.files[0]) onFile(inp.files[0]); inp.value = ''; });
    return el('span', {}, inp, el('button', { class: 'chip', type: 'button', onclick: () => inp.click() }, label));
  };
  const ext = (file) => ({ 'image/png': 'png', 'image/webp': 'webp' }[file.type] ?? 'jpg');
  const imageSize = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
    img.onerror = () => reject(new Error(t('setup.notAPicture')));
    img.src = URL.createObjectURL(file);
  });
  async function upload(file, name) {
    status.textContent = t('setup.uploading');
    await uploadFile(name, file);
    previews.set(name, URL.createObjectURL(file));
    status.textContent = t('setup.uploaded');
    changed();
  }
  const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item';
  const uniqueId = (base, taken) => { let id = base, i = 2; while (taken.includes(id)) id = `${base}_${i++}`; return id; };
  // Entity names as Home Assistant shows them (entities.js).
  const label = (s) => nameOf(s.entity_id, { store, site });
  const entityOptions = (filter) => [['', t('setup.none')], ...store.all()
    .filter(filter)
    .map((s) => [s.entity_id, `${label(s)} · ${s.entity_id}`])
    .sort((a, b) => a[1].localeCompare(b[1], site.locale))];
  const rooms = () => cfg.floorplans.flatMap((p) => (p.rooms ?? []).map((r) => [r.id, `${r.name} (${p.name})`]));

  // Areas still free: not linked to a room or a building yet (plus the one given).
  function freeAreas(keep) {
    const used = new Set([
      ...cfg.floorplans.flatMap((p) => (p.rooms ?? []).map((r) => r.ha_area)),
      ...(cfg.overview?.buildings ?? []).map((b) => b.ha_area),
    ].filter((id) => id && id !== keep));
    return areas.list.filter((a) => !used.has(a.area_id)).map((a) => [a.area_id, a.name]).sort((a, b) => a[1].localeCompare(b[1], site.locale));
  }
  const areaPick = () => (areas.list.length ? { label: t('setup.area'), options: [['', t('setup.noArea')], ...freeAreas()] } : null);

  return { field, section, intro, isExample, exampleNote, input, select, fileButton, ext, imageSize, upload, slug, uniqueId, label, entityOptions, rooms, freeAreas, areaPick };
}
