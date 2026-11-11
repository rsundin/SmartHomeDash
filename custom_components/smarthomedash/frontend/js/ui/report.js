// Report a problem: a sheet that shows what would go into a GitHub issue, and opens
// the bug report form with it filled in. The user reads (and can edit) the text first.
//
// The report holds versions, browser, screen, modes, counts and the config check
// messages. Never entity ids, room or area names, addresses or pictures: issues are
// public. Questions and ideas go to GitHub Discussions instead.

import { el } from '../util.js';
import { t } from '../i18n.js';
import { warnings, configEntities } from '../status.js';
import { liteSetting } from './wall.js';

export const REPO_URL = 'https://github.com/rsundin/SmartHomeDash';
export const DISCUSSIONS_URL = `${REPO_URL}/discussions`;

// The last refused save (Home Assistant's config check, Q5) in this page, or null.
// Those messages name keys and positions only, such as `floorplans[0].rooms[2].area …`.
let lastProblem = null;
export function noteProblem(message) {
  lastProblem = message ? String(message).slice(0, 300) : null;
}

const SOURCES = {
  panel: 'Home Assistant panel',
  login: 'standalone page, Home Assistant login',
  token: 'standalone page, saved token',
  mock: 'standalone page, test data',
};

// Counts per kind: "light 12, climate 3". Domains say nothing about the home.
function byDomain(ids) {
  const n = new Map();
  for (const id of ids) { const d = id.split('.')[0]; n.set(d, (n.get(d) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d} ${c}`).join(', ') || 'none';
}

/** The text that goes into the issue, in English for the maintainer. */
export async function reportText({ site, store, adapter, source }) {
  let ha = null;
  try { ha = await adapter.haVersion?.(); } catch { /* not available */ }
  const plans = site.floorplans ?? [];
  const rooms = plans.reduce((n, p) => n + (p.rooms?.length ?? 0), 0);
  const ids = configEntities(site.raw ?? {}).map((e) => e.id);
  const list = (() => { try { return warnings(site, store, (id) => id); } catch { return []; } })();
  const warn = new Map();
  for (const w of list) {
    const kind = w.items ? w.key : w.level;
    warn.set(kind, (warn.get(kind) ?? 0) + (w.items?.length ?? 1));
  }
  const lite = liteSetting();
  const body = document.body.classList;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const lines = [
    `SmartHomeDash: ${window.SHD_VERSION || 'unknown'}`,
    `Home Assistant: ${ha || 'unknown'}`,
    `Opened as: ${SOURCES[source] ?? source}`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${screen.width}×${screen.height}, window ${innerWidth}×${innerHeight}, pixel ratio ${devicePixelRatio}${touch ? ', touch' : ''}`,
    `Kiosk mode: ${body.contains('is-kiosk') ? 'on' : 'off'}`,
    `Light mode: ${body.contains('is-lite') ? 'on' : 'off'} (setting ${lite})`,
    `Language: ${site.language ?? 'sv'}`,
    `Dashboard: ${site.overview ? 'overview picture' : 'no overview picture'}, ${plans.length} floor plan(s), ${rooms} room(s)`,
    `Devices in site.json: ${byDomain(ids)}; shown from Home Assistant areas: ${site.autoPlaced?.size ?? 0}`,
    `Config check: ${warn.size ? [...warn].map(([k, c]) => `${k} ${c}`).join(', ') : 'no warnings'}`,
    `Last refused save: ${lastProblem ?? 'none'}`,
  ];
  return { text: lines.join('\n'), ha };
}

/** The address of a new bug report with the form filled in (field ids in bug_report.yml). */
export function issueUrl(text, { ha } = {}) {
  const q = new URLSearchParams({ template: 'bug_report.yml', labels: 'bug' });
  if (window.SHD_VERSION) q.set('version', window.SHD_VERSION);
  if (ha) q.set('ha', ha);
  q.set('dashboard', text);
  return `${REPO_URL}/issues/new?${q}`;
}

export function createReport(ctx) {
  const area = el('textarea', { class: 'report-text', id: 'report-text', rows: 10, spellcheck: 'false', 'aria-label': t('report.preview') });
  const link = el('a', { class: 'chip chip-primary', id: 'report-open', target: '_blank', rel: 'noopener noreferrer' }, t('report.open'));
  const msg = el('p', { class: 'muted small', role: 'status' });
  let ha = null;
  const update = () => { link.href = issueUrl(area.value, { ha }); };
  area.addEventListener('input', update);
  const copy = () => {
    navigator.clipboard?.writeText(area.value).then(() => { msg.textContent = t('report.copied'); })
      .catch(() => { area.select(); msg.textContent = t('report.copyManual'); });
  };

  const close = () => { root.hidden = true; };
  const root = el('div', { class: 'sheet report', hidden: true },
    el('div', { class: 'sheet-card', role: 'dialog', 'aria-label': t('report.title') },
      el('header', { class: 'panel-head' },
        el('div', {}, el('p', { class: 'eyebrow' }, t('report.eyebrow')), el('h2', { class: 'panel-title' }, t('report.title'))),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('settings.close'), onclick: close }, '×')),
      el('p', { class: 'small' }, t('report.intro')),
      el('label', { class: 'eyebrow', for: 'report-text' }, t('report.preview')),
      area,
      el('div', { class: 'row' }, link, el('button', { class: 'chip', type: 'button', onclick: copy }, t('report.copy'))),
      msg,
      el('p', { class: 'muted small' }, t('report.diagnostics')),
      el('h3', { class: 'eyebrow wall-h' }, t('report.questions')),
      el('p', { class: 'muted small' }, t('report.questionsHelp')),
      el('div', { class: 'row' }, el('a', { class: 'chip', id: 'report-discuss', href: DISCUSSIONS_URL, target: '_blank', rel: 'noopener noreferrer' }, t('report.discuss')))));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  return {
    el: root,
    close,
    async open() {
      msg.textContent = '';
      root.hidden = false;
      const r = await reportText(ctx);
      ha = r.ha;
      area.value = r.text;
      update();
      root.dataset.ready = 'true';
    },
  };
}
